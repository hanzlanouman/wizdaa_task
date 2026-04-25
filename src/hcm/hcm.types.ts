export interface HcmBalanceResult {
  employeeId: string;
  locationId: string;
  balanceHundredths: number;
  externalVersion?: string;
}

export interface HcmApplyResult extends HcmBalanceResult {
  hcmTransactionId: string;
  idempotent: boolean;
}
