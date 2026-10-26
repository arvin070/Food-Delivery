ALTER TABLE deliveries ALTER COLUMN status SET DEFAULT 'ASSIGNED';
UPDATE deliveries SET status='ASSIGNED' WHERE status='PENDING';
INSERT INTO delivery_runs (id,"kitchenId","timeSlotId","serviceDate","deliveryPartnerId",status,"updatedAt")
SELECT 'legacy-run-'||md5(i."kitchenId"||i."timeSlotId"||i."serviceDate"::text||d."deliveryPartnerId"),
i."kitchenId",i."timeSlotId",i."serviceDate",d."deliveryPartnerId",'ASSIGNED',CURRENT_TIMESTAMP
FROM deliveries d JOIN order_items i ON i.id=d."orderItemId"
WHERE d."deliveryStopId" IS NULL AND d."deliveryPartnerId" IS NOT NULL
GROUP BY i."kitchenId",i."timeSlotId",i."serviceDate",d."deliveryPartnerId"
ON CONFLICT ("kitchenId","serviceDate","timeSlotId","deliveryPartnerId") DO NOTHING;

WITH missing AS (
 SELECT DISTINCT r.id AS run_id,i."checkpointId" AS checkpoint_id
 FROM deliveries d JOIN order_items i ON i.id=d."orderItemId"
 JOIN delivery_runs r ON r."kitchenId"=i."kitchenId" AND r."timeSlotId"=i."timeSlotId"
 AND r."serviceDate"=i."serviceDate" AND r."deliveryPartnerId"=d."deliveryPartnerId"
 WHERE d."deliveryStopId" IS NULL
 AND NOT EXISTS (SELECT 1 FROM delivery_stops s WHERE s."deliveryRunId"=r.id AND s."checkpointId"=i."checkpointId")
)
INSERT INTO delivery_stops (id,"deliveryRunId","checkpointId",sequence,"updatedAt")
SELECT 'legacy-stop-'||md5(run_id||checkpoint_id),run_id,checkpoint_id,
COALESCE((SELECT max(sequence) FROM delivery_stops s WHERE s."deliveryRunId"=run_id),0)
+row_number() OVER(PARTITION BY run_id ORDER BY checkpoint_id),CURRENT_TIMESTAMP FROM missing;

UPDATE deliveries d SET "deliveryStopId"=s.id FROM order_items i,delivery_runs r,delivery_stops s
WHERE i.id=d."orderItemId" AND d."deliveryStopId" IS NULL
AND r."kitchenId"=i."kitchenId" AND r."timeSlotId"=i."timeSlotId"
AND r."serviceDate"=i."serviceDate" AND r."deliveryPartnerId"=d."deliveryPartnerId"
AND s."deliveryRunId"=r.id AND s."checkpointId"=i."checkpointId";

UPDATE delivery_stops s SET status='COMPLETED',"completedAt"=CURRENT_TIMESTAMP
WHERE EXISTS(SELECT 1 FROM deliveries d WHERE d."deliveryStopId"=s.id)
AND NOT EXISTS(SELECT 1 FROM deliveries d WHERE d."deliveryStopId"=s.id AND d.status NOT IN('DELIVERED','FAILED'));
UPDATE delivery_stops s SET status='ARRIVED',"arrivedAt"=CURRENT_TIMESTAMP WHERE status='PENDING'
AND EXISTS(SELECT 1 FROM deliveries d WHERE d."deliveryStopId"=s.id AND d.status='AT_CHECKPOINT');
UPDATE delivery_runs r SET status='IN_PROGRESS',"startedAt"=COALESCE("startedAt",CURRENT_TIMESTAMP),"departedAt"=COALESCE("departedAt",CURRENT_TIMESTAMP)
WHERE EXISTS(SELECT 1 FROM delivery_stops s JOIN deliveries d ON d."deliveryStopId"=s.id WHERE s."deliveryRunId"=r.id AND d.status IN('OUT_FOR_DELIVERY','AT_CHECKPOINT'));
UPDATE delivery_runs r SET status='COMPLETED',"completedAt"=CURRENT_TIMESTAMP
WHERE EXISTS(SELECT 1 FROM delivery_stops s WHERE s."deliveryRunId"=r.id)
AND NOT EXISTS(SELECT 1 FROM delivery_stops s WHERE s."deliveryRunId"=r.id AND s.status NOT IN('COMPLETED','SKIPPED'));
