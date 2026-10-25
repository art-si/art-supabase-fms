// 跨域数据只能通过平台集成契约读取，FMS 不依赖 TMS 的实现文件。
export {
  fetchCarrierOptions,
  fetchCustomerOptions,
  fetchCustomerSelectorList
} from '@/api/integration/counterparties'

export {
  fetchAccountingFoundationSummary,
  fetchAccountingReadiness,
  fetchAccountingPeriodList,
  extendAccountingPeriods,
  fetchAccountSetDetail,
  fetchAccountSetList,
  fetchAccountSetOverview,
  fetchAccountSetOptions,
  initializeAccountingDefaults,
  saveAccountSet,
  setAccountingPeriodStatus,
  setAccountSetStatus
} from '@fms/api/modules/accounting/foundation'

export {
  deleteAuxiliaryType,
  deleteOpeningBalance,
  fetchAuxiliaryItemList,
  fetchAuxiliaryTypeDetail,
  fetchAuxiliaryTypeList,
  fetchCurrencyList,
  fetchExchangeRateList,
  fetchOpeningBalanceList,
  fetchOpeningBalanceSummary,
  fetchSubjectList,
  saveAuxiliaryItem,
  saveAuxiliaryType,
  saveCurrency,
  saveExchangeRate,
  saveOpeningBalance,
  saveSubject,
  setAuxiliaryItemEnabled,
  setAuxiliaryTypeEnabled,
  setCurrencyEnabled,
  setOpeningBalanceStatus,
  syncAuxiliaryItems,
  setSubjectEnabled
} from '@fms/api/modules/accounting/base-data'

export {
  deleteVoucherTemplate,
  exportVoucherList,
  fetchVoucherDetail,
  fetchVoucherList,
  fetchVoucherSummary,
  fetchVoucherTemplateDetail,
  fetchVoucherTemplateList,
  saveVoucher,
  saveVoucherTemplate,
  transitionVoucher
} from '@fms/api/modules/accounting/voucher'

export {
  fetchGeneralLedgerReport,
  fetchSubjectBalanceReport,
  fetchSubsidiaryLedgerReport
} from '@fms/api/modules/accounting/ledger'

export {
  fetchCashFlowAllocations,
  fetchFinancialStatementFormulas,
  fetchFinancialStatementItems,
  fetchFinancialStatementReport,
  initializeFinancialStatementItems,
  saveCashFlowAllocations,
  saveFinancialStatementFormulas,
  saveFinancialStatementItem,
  saveFinancialStatementMappings
} from '@fms/api/modules/accounting/financial-report'

export {
  deletePostingRule,
  fetchAccountingWorkloadSummary,
  fetchPostingEventDetail,
  fetchPostingEventList,
  fetchPostingRuleDetail,
  fetchPostingRuleList,
  processPendingPostingEvents,
  retryPostingEvent,
  savePostingRule
} from '@fms/api/modules/accounting/posting'

export {
  autoMatchBankReconciliation,
  deleteFundAccount,
  deleteFundTransfer,
  fetchBankReconciliationDetail,
  fetchBankReconciliationList,
  fetchBankMatchCandidates,
  fetchBankStatementLines,
  fetchBankStatementMatches,
  fetchFundAccountList,
  fetchFundAccountOptions,
  fetchFundAccountOverview,
  fetchFundLedgerList,
  fetchFundTransferActions,
  fetchFundTransferDetail,
  fetchFundTransferList,
  ignoreBankStatementLine,
  importBankReconciliation,
  matchBankStatementLine,
  saveFundAccount,
  saveFundTransfer,
  transitionBankReconciliation,
  transitionFundTransfer,
  unmatchBankStatementLine
} from '@fms/api/modules/treasury/treasury'

export {
  actCommercialBill,
  deleteCommercialBill,
  fetchCommercialBillDetail,
  fetchCommercialBillEvents,
  fetchCommercialBillList,
  fetchCommercialBillSummary,
  saveCommercialBill
} from '@fms/api/modules/specialized/commercial-bill'

export {
  actAssetDepreciationRun,
  actFixedAsset,
  calculateAssetDepreciation,
  deleteAssetCategory,
  deleteFixedAsset,
  fetchAssetCategoryList,
  fetchAssetDepreciationLines,
  fetchAssetDepreciationRuns,
  fetchFixedAssetDetail,
  fetchFixedAssetVehicleOptions,
  fetchFixedAssetList,
  fetchFixedAssetSummary,
  saveAssetCategory,
  saveFixedAsset
} from '@fms/api/modules/specialized/fixed-asset'

export {
  actPayrollRun,
  deletePayrollLine,
  fetchPayrollEmployeeOptions,
  fetchPayrollLines,
  fetchPayrollRunDetail,
  fetchPayrollRunList,
  fetchPayrollSummary,
  importHrCompensationLines,
  savePayrollLine,
  savePayrollRun
} from '@fms/api/modules/specialized/payroll'

export {
  actTaxPeriod,
  deleteTaxLedgerLine,
  fetchTaxLedgerLines,
  fetchTaxPeriodDetail,
  fetchTaxPeriodList,
  fetchTaxSummary,
  saveTaxLedgerLine,
  saveTaxPeriod
} from '@fms/api/modules/specialized/tax-management'

export {
  actPeriodCloseRun,
  fetchPeriodCloseChecks,
  fetchPeriodCloseRunDetail,
  fetchPeriodCloseRuns,
  fetchPeriodCloseSummary,
  generateProfitLossCarryforward,
  runPeriodCloseChecks
} from '@fms/api/modules/specialized/period-close'

export {
  addExpenseItem,
  addWaybillCost,
  analyzeReceivablesCollectionByAi,
  analyzeWaybillCostByAi,
  analyzeWaybillExpenseByAi,
  analyzeWaybillProfitByAi,
  createExpenseReimbursement,
  deleteExpenseItem,
  deleteExpenseReimbursement,
  deleteWaybillCost,
  editExpenseItem,
  editWaybillCost,
  executeExpenseReimbursement,
  exportWaybillCostList,
  exportWaybillProfitList,
  fetchExpenseItemList,
  fetchExpenseItemTree,
  fetchExpenseReimbursementDetail,
  fetchExpenseReimbursementList,
  fetchFinanceWaybillOptions,
  fetchFinanceWorkbench,
  fetchWaybillCostDetail,
  fetchWaybillCostList,
  fetchWaybillCostOverview,
  fetchWaybillExpenseOcrEnabled,
  fetchWaybillExpenseOcrRunList,
  fetchWaybillProfitList,
  reviewWaybillCost,
  reviewWaybillExpenseOcrArtifact,
  submitExpenseReimbursement,
  submitWaybillCost,
  voidWaybillCost
} from '@fms/api/modules/transport/transport-finance'

export {
  analyzeInvoiceAttachmentByAi,
  analyzeInvoiceComplianceByAi,
  createInvoiceCounterpartyFromOcr,
  deleteInvoice,
  exportInvoiceList,
  fetchActiveInvoiceByLegalNo,
  fetchInvoiceDetail,
  fetchInvoiceList,
  fetchInvoiceableStatementList,
  isInvoiceLegalNumberConflict,
  resolveInvoiceCounterparty,
  reviewInvoiceOcrArtifact,
  saveInvoice,
  updateInvoiceStatus
} from '@fms/api/modules/transport/invoice'

export {
  createCustomerStatement,
  deleteCustomerStatement,
  exportCustomerStatementList,
  fetchCustomerStatementDetail,
  fetchCustomerStatementEligibleWaybills,
  fetchCustomerStatementList,
  updateCustomerStatementStatus
} from '@fms/api/modules/transport/customer-settlement'

export {
  createCarrierStatement,
  deleteCarrierStatement,
  exportCarrierStatementList,
  fetchCarrierStatementDetail,
  fetchCarrierStatementEligibleCosts,
  fetchCarrierStatementList,
  updateCarrierStatementStatus
} from '@fms/api/modules/transport/carrier-settlement'

export {
  allocateCarrierPayment,
  allocateCustomerReceipt,
  analyzeBankStatementBatchByAi,
  analyzeCashVoucherByAi,
  commitBankStatementBatchByAi,
  createCarrierPayment,
  createCustomerReceipt,
  exportCashTransactionList,
  fetchCarrierStatementAllocatableList,
  fetchCashTransactionDetail,
  fetchCashTransactionList,
  fetchCustomerStatementAllocatableList,
  reverseCarrierCashAllocation,
  reverseCashAllocation,
  reviewCashVoucherOcrArtifact,
  voidCashTransaction
} from '@fms/api/modules/transport/cash-transaction'

export {
  cancelCarrierPaymentApplication,
  deleteCarrierPaymentApplication,
  executeCarrierPaymentApplication,
  exportCarrierPaymentApplicationList,
  fetchCarrierPaymentApplicationDetail,
  fetchCarrierPaymentApplicationList,
  saveCarrierPaymentApplication,
  submitCarrierPaymentApplication
} from '@fms/api/modules/transport/payment-application'

export { fetchCashForecastOverview } from '@fms/api/modules/treasury/cash-forecast'
export { fetchReceivableAgingOverview } from '@fms/api/modules/transport/receivable-aging'
export { fetchFinancialExceptionOverview } from '@fms/api/modules/financial-exception'

export {
  fetchPayeeInformationList,
  savePayeeInformation,
  deletePayeeInformation,
  type PayeeInformation,
  type PayeeInformationInput,
  type PayeeInformationSearch
} from '@fms/api/modules/expense/payee-information'

export {
  fetchTravelApplicationList,
  fetchTravelItineraryList,
  fetchTravelApplicationDetail,
  saveTravelApplicationDraft,
  deleteTravelApplications,
  fetchExpenseProjectOptions,
  fetchTravelAssignmentOptions,
  type TravelApplication,
  type TravelItinerary,
  type TravelApplicationInput,
  type TravelItineraryInput,
  type TravelApplicationSearch,
  type TravelLineRecord
} from '@fms/api/modules/expense/travel-application'

export {
  fetchTravelApplicantSelector,
  fetchLoanApplicantSelector,
  fetchReimbursementApplicantSelector
} from '@fms/api/modules/expense/expense-applicants'

export {
  fetchTravelLoanList,
  fetchTravelLoanItemList,
  fetchTravelLoanDetail,
  saveTravelLoanDraft,
  deleteTravelLoans,
  prepareTravelLoanPush,
  type TravelLoanPushKind,
  fetchLoanPayeeOptions,
  recordTravelLoanPayment,
  type TravelLoan,
  type TravelLoanItem,
  type TravelLoanPayee,
  type TravelLoanPayment,
  type TravelLoanInput,
  type TravelLoanItemInput,
  type TravelLoanPayeeInput,
  type TravelLoanSearch,
  type TravelLoanItemRecord,
  type LoanPayeeOption
} from '@fms/api/modules/expense/travel-loan'

export {
  fetchTravelRepaymentList,
  fetchTravelRepaymentLineList,
  fetchTravelRepaymentDetail,
  fetchRepayableLoans,
  saveTravelRepaymentDraft,
  submitTravelRepayment,
  deleteTravelRepayments,
  recordTravelRepaymentCollection,
  type TravelRepayment,
  type TravelRepaymentItem,
  type TravelRepaymentReceipt,
  type TravelRepaymentLine,
  type TravelRepaymentSearch,
  type TravelRepaymentInput,
  type TravelRepaymentItemInput,
  type RepayableLoan
} from '@fms/api/modules/expense/travel-repayment'

export {
  deleteTravelReimbursements,
  fetchReimbursementPayeeOptions,
  fetchTravelReimbursementDetail,
  fetchReimbursementLoanOptions,
  type ReimbursementLoanOption,
  fetchReimbursementWorkspaceLines,
  fetchReimbursementWorkspaceList,
  recordTravelReimbursementPayment,
  saveTravelReimbursementDraft,
  type ReimbursementWorkspaceSearch,
  type ReimbursementWorkspaceLine,
  type TravelReimbursementDraftInput,
  type TravelReimbursementLineInput,
  type TravelReimbursementPayeeInput,
  type TravelReimbursementPaymentInput
} from '@fms/api/modules/expense/travel-reimbursement'
