-- Older per-item workflows can leave mixed phases in one newly grouped route.
-- Let riders collect remaining assigned meals without falsifying pickup timestamps.
UPDATE delivery_runs r SET status='ASSIGNED',"startedAt"=NULL,"departedAt"=NULL
WHERE r.status='IN_PROGRESS'
AND EXISTS (SELECT 1 FROM delivery_stops s JOIN deliveries d ON d."deliveryStopId"=s.id
            WHERE s."deliveryRunId"=r.id AND d.status='ASSIGNED');
