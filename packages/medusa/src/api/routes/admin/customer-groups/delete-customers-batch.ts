import { Type } from "class-transformer"
import { ValidateNested } from "class-validator"
import { CustomerGroupService } from "../../../../services"
import { CustomerGroupsBatchCustomer } from "../../../../types/customer-groups"
import { validator } from "../../../../utils/validator"
import { Request, Response } from "express"

/**
 * @oas [delete] /customer-groups/{id}/customers/batch
 * operationId: "DeleteCustomerGroupsGroupCustomerBatch"
 * summary: "Remove a list of customers from a customer group "
 * description: "Removes a list of customers, represented by id's, from a customer group."
 * x-authenticated: true
 * parameters:
 *   - (path) id=* {string} The id of the customer group.
 * requestBody:
 *   content:
 *     application/json:
 *       schema:
 *         properties:
 *           customers:
 *             description: "The ids of the customers to remove"
 *             type: array
 *             items:
 *               required:
 *                 - id
 *               properties:
 *                 id:
 *                   description: Id of the customer
 *                   type: string
 * tags:
 *   - CustomerGroup
 * responses:
 *   200:
 *     description: OK
 *     content:
 *       application/json:
 *         schema:
 *           properties:
 *             customerGroup:
 *               $ref: "#/components/schemas/customer_group"
 */

export default async (req: Request, res: Response) => {
  const { id } = req.params
  const validated = await validator(
    AdminDeleteCustomerGroupsGroupCustomerBatchReq,
    req.body
  )

  const customerGroupService: CustomerGroupService = req.scope.resolve(
    "customerGroupService"
  )

  const customer_group = await customerGroupService.removeCustomer(
    id,
    validated.customer_ids.map(({ id }) => id)
  )
  res.status(200).json({ customer_group })
}

export class AdminDeleteCustomerGroupsGroupCustomerBatchReq {
  @ValidateNested({ each: true })
  @Type(() => CustomerGroupsBatchCustomer)
  customer_ids: CustomerGroupsBatchCustomer[]
}
