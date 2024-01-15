import {
  Context,
  DAL,
  FindConfig,
  InternalModuleDeclaration,
  ModuleJoinerConfig,
  PromotionTypes,
} from "@medusajs/types"
import {
  ApplicationMethodTargetType,
  InjectManager,
  InjectTransactionManager,
  MedusaContext,
  MedusaError,
  isString,
} from "@medusajs/utils"
import { ApplicationMethod, Promotion } from "@models"
import {
  ApplicationMethodService,
  CampaignBudgetService,
  CampaignService,
  PromotionRuleService,
  PromotionRuleValueService,
  PromotionService,
} from "@services"
import {
  CreateApplicationMethodDTO,
  CreateCampaignBudgetDTO,
  CreateCampaignDTO,
  CreatePromotionDTO,
  CreatePromotionRuleDTO,
  UpdateApplicationMethodDTO,
  UpdateCampaignBudgetDTO,
  UpdateCampaignDTO,
  UpdatePromotionDTO,
} from "@types"
import {
  ComputeActionUtils,
  allowedAllocationForQuantity,
  areRulesValidForContext,
  validateApplicationMethodAttributes,
  validatePromotionRuleAttributes,
} from "@utils"
import { joinerConfig } from "../joiner-config"

type InjectedDependencies = {
  baseRepository: DAL.RepositoryService
  promotionService: PromotionService
  applicationMethodService: ApplicationMethodService
  promotionRuleService: PromotionRuleService
  promotionRuleValueService: PromotionRuleValueService
  campaignService: CampaignService
  campaignBudgetService: CampaignBudgetService
}

export default class PromotionModuleService<
  TPromotion extends Promotion = Promotion
> implements PromotionTypes.IPromotionModuleService
{
  protected baseRepository_: DAL.RepositoryService
  protected promotionService_: PromotionService
  protected applicationMethodService_: ApplicationMethodService
  protected promotionRuleService_: PromotionRuleService
  protected promotionRuleValueService_: PromotionRuleValueService
  protected campaignService_: CampaignService
  protected campaignBudgetService_: CampaignBudgetService

  constructor(
    {
      baseRepository,
      promotionService,
      applicationMethodService,
      promotionRuleService,
      promotionRuleValueService,
      campaignService,
      campaignBudgetService,
    }: InjectedDependencies,
    protected readonly moduleDeclaration: InternalModuleDeclaration
  ) {
    this.baseRepository_ = baseRepository
    this.promotionService_ = promotionService
    this.applicationMethodService_ = applicationMethodService
    this.promotionRuleService_ = promotionRuleService
    this.promotionRuleValueService_ = promotionRuleValueService
    this.campaignService_ = campaignService
    this.campaignBudgetService_ = campaignBudgetService
  }

  __joinerConfig(): ModuleJoinerConfig {
    return joinerConfig
  }

  async computeActions(
    promotionCodesToApply: string[],
    applicationContext: PromotionTypes.ComputeActionContext,
    // TODO: specify correct type with options
    options: Record<string, any> = {}
  ): Promise<PromotionTypes.ComputeActions[]> {
    const computedActions: PromotionTypes.ComputeActions[] = []
    const { items = [], shipping_methods: shippingMethods = [] } =
      applicationContext
    const appliedItemCodes: string[] = []
    const appliedShippingCodes: string[] = []
    const codeAdjustmentMap = new Map<
      string,
      PromotionTypes.ComputeActionAdjustmentLine
    >()
    const methodIdPromoValueMap = new Map<string, number>()

    items.forEach((item) => {
      item.adjustments?.forEach((adjustment) => {
        if (isString(adjustment.code)) {
          codeAdjustmentMap.set(adjustment.code, adjustment)
          appliedItemCodes.push(adjustment.code)
        }
      })
    })

    shippingMethods.forEach((shippingMethod) => {
      shippingMethod.adjustments?.forEach((adjustment) => {
        if (isString(adjustment.code)) {
          codeAdjustmentMap.set(adjustment.code, adjustment)
          appliedShippingCodes.push(adjustment.code)
        }
      })
    })

    const promotions = await this.list(
      {
        code: [
          ...promotionCodesToApply,
          ...appliedItemCodes,
          ...appliedShippingCodes,
        ],
      },
      {
        relations: [
          "application_method",
          "application_method.target_rules",
          "application_method.target_rules.values",
          "rules",
          "rules.values",
        ],
      }
    )

    const existingPromotionsMap = new Map<string, PromotionTypes.PromotionDTO>(
      promotions.map((promotion) => [promotion.code!, promotion])
    )

    for (const appliedCode of [...appliedShippingCodes, ...appliedItemCodes]) {
      const promotion = existingPromotionsMap.get(appliedCode)

      if (!promotion) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Applied Promotion for code (${appliedCode}) not found`
        )
      }

      if (promotionCodesToApply.includes(appliedCode)) {
        continue
      }

      if (appliedItemCodes.includes(appliedCode)) {
        computedActions.push({
          action: "removeItemAdjustment",
          adjustment_id: codeAdjustmentMap.get(appliedCode)!.id,
        })
      }

      if (appliedShippingCodes.includes(appliedCode)) {
        computedActions.push({
          action: "removeShippingMethodAdjustment",
          adjustment_id: codeAdjustmentMap.get(appliedCode)!.id,
        })
      }
    }

    for (const promotionCode of promotionCodesToApply) {
      const promotion = existingPromotionsMap.get(promotionCode)

      if (!promotion) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Promotion for code (${promotionCode}) not found`
        )
      }

      const {
        application_method: applicationMethod,
        rules: promotionRules = [],
      } = promotion

      if (!applicationMethod) {
        continue
      }

      const isPromotionApplicable = areRulesValidForContext(
        promotionRules,
        applicationContext
      )

      if (!isPromotionApplicable) {
        continue
      }

      if (applicationMethod.target_type === ApplicationMethodTargetType.ORDER) {
        const computedActionsForItems =
          ComputeActionUtils.getComputedActionsForOrder(
            promotion,
            applicationContext,
            methodIdPromoValueMap
          )

        computedActions.push(...computedActionsForItems)
      }

      if (applicationMethod.target_type === ApplicationMethodTargetType.ITEMS) {
        const computedActionsForItems =
          ComputeActionUtils.getComputedActionsForItems(
            promotion,
            applicationContext[ApplicationMethodTargetType.ITEMS],
            methodIdPromoValueMap
          )

        computedActions.push(...computedActionsForItems)
      }

      if (
        applicationMethod.target_type ===
        ApplicationMethodTargetType.SHIPPING_METHODS
      ) {
        const computedActionsForShippingMethods =
          ComputeActionUtils.getComputedActionsForShippingMethods(
            promotion,
            applicationContext[ApplicationMethodTargetType.SHIPPING_METHODS],
            methodIdPromoValueMap
          )

        computedActions.push(...computedActionsForShippingMethods)
      }
    }

    return computedActions
  }

  @InjectManager("baseRepository_")
  async retrieve(
    id: string,
    config: FindConfig<PromotionTypes.PromotionDTO> = {},
    @MedusaContext() sharedContext: Context = {}
  ): Promise<PromotionTypes.PromotionDTO> {
    const promotion = await this.promotionService_.retrieve(
      id,
      config,
      sharedContext
    )

    return await this.baseRepository_.serialize<PromotionTypes.PromotionDTO>(
      promotion,
      {
        populate: true,
      }
    )
  }

  @InjectManager("baseRepository_")
  async list(
    filters: PromotionTypes.FilterablePromotionProps = {},
    config: FindConfig<PromotionTypes.PromotionDTO> = {},
    @MedusaContext() sharedContext: Context = {}
  ): Promise<PromotionTypes.PromotionDTO[]> {
    const promotions = await this.promotionService_.list(
      filters,
      config,
      sharedContext
    )

    return await this.baseRepository_.serialize<PromotionTypes.PromotionDTO[]>(
      promotions,
      {
        populate: true,
      }
    )
  }

  async create(
    data: PromotionTypes.CreatePromotionDTO,
    sharedContext?: Context
  ): Promise<PromotionTypes.PromotionDTO>

  async create(
    data: PromotionTypes.CreatePromotionDTO[],
    sharedContext?: Context
  ): Promise<PromotionTypes.PromotionDTO[]>

  @InjectManager("baseRepository_")
  async create(
    data:
      | PromotionTypes.CreatePromotionDTO
      | PromotionTypes.CreatePromotionDTO[],
    @MedusaContext() sharedContext: Context = {}
  ): Promise<PromotionTypes.PromotionDTO | PromotionTypes.PromotionDTO[]> {
    const input = Array.isArray(data) ? data : [data]
    const createdPromotions = await this.create_(input, sharedContext)

    const promotions = await this.list(
      { id: createdPromotions.map((p) => p!.id) },
      {
        relations: [
          "application_method",
          "application_method.target_rules",
          "application_method.target_rules.values",
          "rules",
          "rules.values",
          "campaign",
        ],
      },
      sharedContext
    )

    return Array.isArray(data) ? promotions : promotions[0]
  }

  @InjectTransactionManager("baseRepository_")
  protected async create_(
    data: PromotionTypes.CreatePromotionDTO[],
    @MedusaContext() sharedContext: Context = {}
  ) {
    const promotionsData: CreatePromotionDTO[] = []
    const applicationMethodsData: CreateApplicationMethodDTO[] = []
    const campaignsData: CreateCampaignDTO[] = []

    const promotionCodeApplicationMethodDataMap = new Map<
      string,
      PromotionTypes.CreateApplicationMethodDTO
    >()
    const promotionCodeRulesDataMap = new Map<
      string,
      PromotionTypes.CreatePromotionRuleDTO[]
    >()
    const applicationMethodRuleMap = new Map<
      string,
      PromotionTypes.CreatePromotionRuleDTO[]
    >()
    const promotionCodeCampaignMap = new Map<
      string,
      PromotionTypes.CreateCampaignDTO
    >()

    for (const {
      application_method: applicationMethodData,
      rules: rulesData,
      campaign: campaignData,
      campaign_id: campaignId,
      ...promotionData
    } of data) {
      if (applicationMethodData) {
        promotionCodeApplicationMethodDataMap.set(
          promotionData.code,
          applicationMethodData
        )
      }

      if (rulesData) {
        promotionCodeRulesDataMap.set(promotionData.code, rulesData)
      }

      if (campaignData && campaignId) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Provide either the 'campaign' or 'campaign_id' parameter; both cannot be used simultaneously.`
        )
      }

      if (campaignData) {
        promotionCodeCampaignMap.set(promotionData.code, campaignData)
      }

      promotionsData.push({
        ...promotionData,
        campaign: campaignId,
      })
    }

    const createdPromotions = await this.promotionService_.create(
      promotionsData,
      sharedContext
    )

    for (const promotion of createdPromotions) {
      const applMethodData = promotionCodeApplicationMethodDataMap.get(
        promotion.code
      )

      const campaignData = promotionCodeCampaignMap.get(promotion.code)

      if (campaignData) {
        campaignsData.push({
          ...campaignData,
          promotions: [promotion],
        })
      }

      if (applMethodData) {
        const {
          target_rules: targetRulesData = [],
          ...applicationMethodWithoutRules
        } = applMethodData
        const applicationMethodData = {
          ...applicationMethodWithoutRules,
          promotion,
        }

        if (
          applicationMethodData.target_type ===
            ApplicationMethodTargetType.ORDER &&
          targetRulesData.length
        ) {
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            `Target rules for application method with target type (${ApplicationMethodTargetType.ORDER}) is not allowed`
          )
        }

        validateApplicationMethodAttributes(applicationMethodData)
        applicationMethodsData.push(applicationMethodData)

        if (targetRulesData.length) {
          applicationMethodRuleMap.set(promotion.id, targetRulesData)
        }
      }

      await this.createPromotionRulesAndValues(
        promotionCodeRulesDataMap.get(promotion.code) || [],
        "promotions",
        promotion,
        sharedContext
      )
    }

    const createdApplicationMethods =
      await this.applicationMethodService_.create(
        applicationMethodsData,
        sharedContext
      )

    if (campaignsData.length) {
      await this.createCampaigns(campaignsData, sharedContext)
    }

    for (const applicationMethod of createdApplicationMethods) {
      await this.createPromotionRulesAndValues(
        applicationMethodRuleMap.get(applicationMethod.promotion.id) || [],
        "application_methods",
        applicationMethod,
        sharedContext
      )
    }

    return createdPromotions
  }

  async update(
    data: PromotionTypes.UpdatePromotionDTO,
    sharedContext?: Context
  ): Promise<PromotionTypes.PromotionDTO>

  async update(
    data: PromotionTypes.UpdatePromotionDTO[],
    sharedContext?: Context
  ): Promise<PromotionTypes.PromotionDTO[]>

  @InjectManager("baseRepository_")
  async update(
    data:
      | PromotionTypes.UpdatePromotionDTO
      | PromotionTypes.UpdatePromotionDTO[],
    @MedusaContext() sharedContext: Context = {}
  ): Promise<PromotionTypes.PromotionDTO | PromotionTypes.PromotionDTO[]> {
    const input = Array.isArray(data) ? data : [data]
    const updatedPromotions = await this.update_(input, sharedContext)

    const promotions = await this.list(
      { id: updatedPromotions.map((p) => p!.id) },
      {
        relations: [
          "application_method",
          "application_method.target_rules",
          "rules",
          "rules.values",
        ],
      },
      sharedContext
    )

    return Array.isArray(data) ? promotions : promotions[0]
  }

  @InjectTransactionManager("baseRepository_")
  protected async update_(
    data: PromotionTypes.UpdatePromotionDTO[],
    @MedusaContext() sharedContext: Context = {}
  ) {
    const promotionIds = data.map((d) => d.id)
    const existingPromotions = await this.promotionService_.list(
      { id: promotionIds },
      { relations: ["application_method"] }
    )

    const existingPromotionsMap = new Map<string, Promotion>(
      existingPromotions.map((promotion) => [promotion.id, promotion])
    )

    const promotionsData: UpdatePromotionDTO[] = []
    const applicationMethodsData: UpdateApplicationMethodDTO[] = []

    for (const {
      application_method: applicationMethodData,
      ...promotionData
    } of data) {
      promotionsData.push(promotionData)

      if (!applicationMethodData) {
        continue
      }

      const existingPromotion = existingPromotionsMap.get(promotionData.id)
      const existingApplicationMethod = existingPromotion?.application_method

      if (!existingApplicationMethod) {
        continue
      }

      if (
        applicationMethodData.allocation &&
        !allowedAllocationForQuantity.includes(applicationMethodData.allocation)
      ) {
        applicationMethodData.max_quantity = null
      }

      validateApplicationMethodAttributes({
        type: applicationMethodData.type || existingApplicationMethod.type,
        target_type:
          applicationMethodData.target_type ||
          existingApplicationMethod.target_type,
        allocation:
          applicationMethodData.allocation ||
          existingApplicationMethod.allocation,
        max_quantity:
          applicationMethodData.max_quantity ||
          existingApplicationMethod.max_quantity,
      })

      applicationMethodsData.push(applicationMethodData)
    }

    const updatedPromotions = this.promotionService_.update(
      promotionsData,
      sharedContext
    )

    if (applicationMethodsData.length) {
      await this.applicationMethodService_.update(
        applicationMethodsData,
        sharedContext
      )
    }

    return updatedPromotions
  }

  @InjectManager("baseRepository_")
  @InjectTransactionManager("baseRepository_")
  async addPromotionRules(
    promotionId: string,
    rulesData: PromotionTypes.CreatePromotionRuleDTO[],
    @MedusaContext() sharedContext: Context = {}
  ): Promise<PromotionTypes.PromotionDTO> {
    const promotion = await this.promotionService_.retrieve(promotionId)

    await this.createPromotionRulesAndValues(
      rulesData,
      "promotions",
      promotion,
      sharedContext
    )

    return this.retrieve(promotionId, {
      relations: ["rules", "rules.values"],
    })
  }

  @InjectManager("baseRepository_")
  @InjectTransactionManager("baseRepository_")
  async addPromotionTargetRules(
    promotionId: string,
    rulesData: PromotionTypes.CreatePromotionRuleDTO[],
    @MedusaContext() sharedContext: Context = {}
  ): Promise<PromotionTypes.PromotionDTO> {
    const promotion = await this.promotionService_.retrieve(promotionId, {
      relations: ["application_method"],
    })

    const applicationMethod = promotion.application_method

    if (!applicationMethod) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `application_method for promotion not found`
      )
    }

    await this.createPromotionRulesAndValues(
      rulesData,
      "application_methods",
      applicationMethod,
      sharedContext
    )

    return this.retrieve(promotionId, {
      relations: [
        "rules",
        "rules.values",
        "application_method",
        "application_method.target_rules",
        "application_method.target_rules.values",
      ],
    })
  }

  protected async createPromotionRulesAndValues(
    rulesData: PromotionTypes.CreatePromotionRuleDTO[],
    relationName: "promotions" | "application_methods",
    relation: Promotion | ApplicationMethod,
    sharedContext: Context
  ) {
    validatePromotionRuleAttributes(rulesData)

    for (const ruleData of rulesData) {
      const { values, ...rest } = ruleData
      const promotionRuleData: CreatePromotionRuleDTO = {
        ...rest,
        [relationName]: [relation],
      }

      const [createdPromotionRule] = await this.promotionRuleService_.create(
        [promotionRuleData],
        sharedContext
      )

      const ruleValues = Array.isArray(values) ? values : [values]
      const promotionRuleValuesData = ruleValues.map((ruleValue) => ({
        value: ruleValue,
        promotion_rule: createdPromotionRule,
      }))

      await this.promotionRuleValueService_.create(promotionRuleValuesData)
    }
  }

  @InjectTransactionManager("baseRepository_")
  async delete(
    ids: string | string[],
    @MedusaContext() sharedContext: Context = {}
  ): Promise<void> {
    const promotionIds = Array.isArray(ids) ? ids : [ids]

    await this.promotionService_.delete(promotionIds, sharedContext)
  }

  @InjectManager("baseRepository_")
  async removePromotionRules(
    promotionId: string,
    rulesData: PromotionTypes.RemovePromotionRuleDTO[],
    @MedusaContext() sharedContext: Context = {}
  ): Promise<PromotionTypes.PromotionDTO> {
    await this.removePromotionRules_(promotionId, rulesData, sharedContext)

    return this.retrieve(
      promotionId,
      { relations: ["rules", "rules.values"] },
      sharedContext
    )
  }

  @InjectTransactionManager("baseRepository_")
  protected async removePromotionRules_(
    promotionId: string,
    rulesData: PromotionTypes.RemovePromotionRuleDTO[],
    @MedusaContext() sharedContext: Context = {}
  ): Promise<void> {
    const promotionRuleIdsToRemove = rulesData.map((ruleData) => ruleData.id)
    const promotion = await this.promotionService_.retrieve(
      promotionId,
      { relations: ["rules"] },
      sharedContext
    )

    const existingPromotionRuleIds = promotion.rules
      .toArray()
      .map((rule) => rule.id)

    const idsToRemove = promotionRuleIdsToRemove.filter((ruleId) =>
      existingPromotionRuleIds.includes(ruleId)
    )

    await this.promotionRuleService_.delete(idsToRemove, sharedContext)
  }

  @InjectManager("baseRepository_")
  async removePromotionTargetRules(
    promotionId: string,
    rulesData: PromotionTypes.RemovePromotionRuleDTO[],
    @MedusaContext() sharedContext: Context = {}
  ): Promise<PromotionTypes.PromotionDTO> {
    await this.removePromotionTargetRules_(
      promotionId,
      rulesData,
      sharedContext
    )

    return this.retrieve(
      promotionId,
      {
        relations: [
          "rules",
          "rules.values",
          "application_method",
          "application_method.target_rules",
          "application_method.target_rules.values",
        ],
      },
      sharedContext
    )
  }

  @InjectTransactionManager("baseRepository_")
  protected async removePromotionTargetRules_(
    promotionId: string,
    rulesData: PromotionTypes.RemovePromotionRuleDTO[],
    @MedusaContext() sharedContext: Context = {}
  ): Promise<void> {
    const promotionRuleIds = rulesData.map((ruleData) => ruleData.id)
    const promotion = await this.promotionService_.retrieve(
      promotionId,
      { relations: ["application_method.target_rules"] },
      sharedContext
    )

    const applicationMethod = promotion.application_method

    if (!applicationMethod) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `application_method for promotion not found`
      )
    }

    const targetRuleIdsToRemove = applicationMethod.target_rules
      .toArray()
      .filter((rule) => promotionRuleIds.includes(rule.id))
      .map((rule) => rule.id)

    await this.promotionRuleService_.delete(
      targetRuleIdsToRemove,
      sharedContext
    )
  }

  @InjectManager("baseRepository_")
  async retrieveCampaign(
    id: string,
    config: FindConfig<PromotionTypes.CampaignDTO> = {},
    @MedusaContext() sharedContext: Context = {}
  ): Promise<PromotionTypes.CampaignDTO> {
    const campaign = await this.campaignService_.retrieve(
      id,
      config,
      sharedContext
    )

    return await this.baseRepository_.serialize<PromotionTypes.CampaignDTO>(
      campaign,
      {
        populate: true,
      }
    )
  }

  @InjectManager("baseRepository_")
  async listCampaigns(
    filters: PromotionTypes.FilterableCampaignProps = {},
    config: FindConfig<PromotionTypes.CampaignDTO> = {},
    @MedusaContext() sharedContext: Context = {}
  ): Promise<PromotionTypes.CampaignDTO[]> {
    const campaigns = await this.campaignService_.list(
      filters,
      config,
      sharedContext
    )

    return await this.baseRepository_.serialize<PromotionTypes.CampaignDTO[]>(
      campaigns,
      {
        populate: true,
      }
    )
  }

  async createCampaigns(
    data: PromotionTypes.CreateCampaignDTO,
    sharedContext?: Context
  ): Promise<PromotionTypes.CampaignDTO>

  async createCampaigns(
    data: PromotionTypes.CreateCampaignDTO[],
    sharedContext?: Context
  ): Promise<PromotionTypes.CampaignDTO[]>

  @InjectManager("baseRepository_")
  async createCampaigns(
    data: PromotionTypes.CreateCampaignDTO | PromotionTypes.CreateCampaignDTO[],
    @MedusaContext() sharedContext: Context = {}
  ): Promise<PromotionTypes.CampaignDTO | PromotionTypes.CampaignDTO[]> {
    const input = Array.isArray(data) ? data : [data]
    const createdCampaigns = await this.createCampaigns_(input, sharedContext)

    const campaigns = await this.listCampaigns(
      { id: createdCampaigns.map((p) => p!.id) },
      {
        relations: ["budget"],
      },
      sharedContext
    )

    return Array.isArray(data) ? campaigns : campaigns[0]
  }

  @InjectTransactionManager("baseRepository_")
  protected async createCampaigns_(
    data: PromotionTypes.CreateCampaignDTO[],
    @MedusaContext() sharedContext: Context = {}
  ) {
    const campaignsData: CreateCampaignDTO[] = []
    const campaignBudgetsData: CreateCampaignBudgetDTO[] = []
    const campaignIdentifierBudgetMap = new Map<
      string,
      CreateCampaignBudgetDTO
    >()

    for (const createCampaignData of data) {
      const {
        budget: campaignBudgetData,
        promotions,
        ...campaignData
      } = createCampaignData

      const promotionsToAdd = promotions
        ? await this.list(
            {
              id: promotions.map((p) => p.id),
            },
            {},
            sharedContext
          )
        : []

      if (campaignBudgetData) {
        campaignIdentifierBudgetMap.set(
          campaignData.campaign_identifier,
          campaignBudgetData
        )
      }

      campaignsData.push({
        ...campaignData,
        promotions: promotionsToAdd,
      })
    }

    const createdCampaigns = await this.campaignService_.create(
      campaignsData,
      sharedContext
    )

    for (const createdCampaign of createdCampaigns) {
      const campaignBudgetData = campaignIdentifierBudgetMap.get(
        createdCampaign.campaign_identifier
      )

      if (campaignBudgetData) {
        campaignBudgetsData.push({
          ...campaignBudgetData,
          campaign: createdCampaign.id,
        })
      }
    }

    if (campaignBudgetsData.length) {
      await this.campaignBudgetService_.create(
        campaignBudgetsData,
        sharedContext
      )
    }

    return createdCampaigns
  }

  async updateCampaigns(
    data: PromotionTypes.UpdateCampaignDTO,
    sharedContext?: Context
  ): Promise<PromotionTypes.CampaignDTO>

  async updateCampaigns(
    data: PromotionTypes.UpdateCampaignDTO[],
    sharedContext?: Context
  ): Promise<PromotionTypes.CampaignDTO[]>

  @InjectManager("baseRepository_")
  async updateCampaigns(
    data: PromotionTypes.UpdateCampaignDTO | PromotionTypes.UpdateCampaignDTO[],
    @MedusaContext() sharedContext: Context = {}
  ): Promise<PromotionTypes.CampaignDTO | PromotionTypes.CampaignDTO[]> {
    const input = Array.isArray(data) ? data : [data]

    const updatedCampaigns = await this.updateCampaigns_(input, sharedContext)

    const campaigns = await this.listCampaigns(
      { id: updatedCampaigns.map((p) => p!.id) },
      {
        relations: ["budget"],
      },
      sharedContext
    )

    return Array.isArray(data) ? campaigns : campaigns[0]
  }

  @InjectTransactionManager("baseRepository_")
  protected async updateCampaigns_(
    data: PromotionTypes.UpdateCampaignDTO[],
    @MedusaContext() sharedContext: Context = {}
  ) {
    const campaignIds = data.map((d) => d.id)
    const campaignsData: UpdateCampaignDTO[] = []
    const campaignBudgetsData: UpdateCampaignBudgetDTO[] = []

    const existingCampaigns = await this.listCampaigns(
      {
        id: campaignIds,
      },
      {
        relations: ["budget"],
      },
      sharedContext
    )

    const existingCampaignsMap = new Map<string, PromotionTypes.CampaignDTO>(
      existingCampaigns.map((campaign) => [campaign.id, campaign])
    )

    for (const updateCampaignData of data) {
      const { budget: campaignBudgetData, ...campaignData } = updateCampaignData

      const existingCampaign = existingCampaignsMap.get(campaignData.id)
      const existingCampaignBudget = existingCampaign?.budget

      campaignsData.push(campaignData)

      if (existingCampaignBudget && campaignBudgetData) {
        campaignBudgetsData.push({
          id: existingCampaignBudget.id,
          ...campaignBudgetData,
        })
      }
    }

    const updatedCampaigns = await this.campaignService_.update(campaignsData)

    if (campaignBudgetsData.length) {
      await this.campaignBudgetService_.update(campaignBudgetsData)
    }

    return updatedCampaigns
  }

  @InjectTransactionManager("baseRepository_")
  async deleteCampaigns(
    ids: string | string[],
    @MedusaContext() sharedContext: Context = {}
  ): Promise<void> {
    const campaignIds = Array.isArray(ids) ? ids : [ids]

    await this.promotionService_.delete(campaignIds, sharedContext)
  }
}
