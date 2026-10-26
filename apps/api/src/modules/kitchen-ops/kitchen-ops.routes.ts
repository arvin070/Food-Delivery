import { Router } from 'express';
import { z } from 'zod';
import { idSchema, kitchenOperationsQuerySchema, kitchenOperationsStatusSchema, kitchenGroupStatusSchema } from '@lunch/shared';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { authorizeAdmin, authorizeVendor } from '../../middleware/authorize';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate';
import { asyncHandler, ok } from '../../core/http';
import { notFound } from '../../core/errors';
import { prisma } from '../../core/prisma';
import { listAccessibleKitchens } from './kitchen-access';
import * as service from './kitchen-ops.service';
export const kitchenOperationsRouter = Router();
kitchenOperationsRouter.use(authenticate, authorizeVendor());
kitchenOperationsRouter.get('/kitchens', asyncHandler(async (req,res) => ok(res, await listAccessibleKitchens(requireAuth(req)))));
kitchenOperationsRouter.use('/:kitchenId', validateParams(z.object({ kitchenId: idSchema })));
kitchenOperationsRouter.get('/:kitchenId/dashboard', validateQuery(kitchenOperationsQuerySchema), asyncHandler(async (req,res) => ok(res, await service.kitchenDashboard(requireAuth(req),req.params.kitchenId as string,req.query as never))));
kitchenOperationsRouter.get('/:kitchenId/packing', validateQuery(kitchenOperationsQuerySchema), asyncHandler(async (req,res) => ok(res, await service.packingList(requireAuth(req),req.params.kitchenId as string,req.query as never))));
kitchenOperationsRouter.post('/:kitchenId/items/status', validateBody(kitchenOperationsStatusSchema), asyncHandler(async (req,res) => ok(res, await service.updateKitchenItems(requireAuth(req),req.params.kitchenId as string,req.body))));
kitchenOperationsRouter.post('/:kitchenId/groups/status', validateBody(kitchenGroupStatusSchema), asyncHandler(async (req,res) => ok(res, await service.updateKitchenGroup(requireAuth(req),req.params.kitchenId as string,req.body))));

export const kitchenStaffRouter = Router();
kitchenStaffRouter.use(authenticate, authorizeAdmin());
kitchenStaffRouter.use('/:kitchenId/staff/:userId', validateParams(z.object({ kitchenId: idSchema, userId: idSchema })));
kitchenStaffRouter.put('/:kitchenId/staff/:userId', asyncHandler(async (req,res) => {
  const kitchenId=req.params.kitchenId as string, userId=req.params.userId as string;
  const result=await prisma.$transaction(async tx => {
    if (!await tx.kitchen.count({where:{id:kitchenId,deletedAt:null}})) throw notFound('Kitchen');
    if (!await tx.user.count({where:{id:userId,role:'VENDOR',status:'ACTIVE',deletedAt:null}})) throw notFound('Active vendor-role staff user');
    const assignment=await tx.kitchenStaff.upsert({where:{userId_kitchenId:{userId,kitchenId}},create:{userId,kitchenId},update:{}});
    await tx.auditLog.create({data:{actorUserId:requireAuth(req).userId,action:'kitchen.staff.assigned',entityType:'KitchenStaff',entityId:assignment.id,after:{userId,kitchenId}}});
    return assignment;
  });
  return ok(res,result);
}));
kitchenStaffRouter.delete('/:kitchenId/staff/:userId', asyncHandler(async (req,res) => {
  const kitchenId=req.params.kitchenId as string, userId=req.params.userId as string;
  await prisma.$transaction(async tx => {
    await tx.kitchenStaff.deleteMany({where:{kitchenId,userId}});
    await tx.auditLog.create({data:{actorUserId:requireAuth(req).userId,action:'kitchen.staff.revoked',entityType:'KitchenStaff',after:{userId,kitchenId}}});
  });
  return ok(res,{revoked:true});
}));
