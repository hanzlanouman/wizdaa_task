export enum TimeOffRequestStatus {
  Pending = 'PENDING',
  Approving = 'APPROVING',
  Approved = 'APPROVED',
  Rejected = 'REJECTED',
  Cancelled = 'CANCELLED',
}

export enum BalanceSource {
  HcmBatch = 'HCM_BATCH',
  HcmRealtime = 'HCM_REALTIME',
  Seed = 'SEED',
}

export enum SyncStatus {
  Success = 'SUCCESS',
  Failed = 'FAILED',
}
