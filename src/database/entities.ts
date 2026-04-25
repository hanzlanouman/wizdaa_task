import { HcmSimulatorAppliedRequest, HcmSimulatorBalance, HcmSimulatorConfig } from './hcm-simulator';
import { Balance, BalanceSyncEvent, RequestEvent, TimeOffRequest } from './timeoff';

export const timeOffEntities = [
  Balance,
  BalanceSyncEvent,
  RequestEvent,
  TimeOffRequest,
];

export const hcmSimulatorEntities = [
  HcmSimulatorAppliedRequest,
  HcmSimulatorBalance,
  HcmSimulatorConfig,
];

export {
  Balance,
  BalanceSyncEvent,
  HcmSimulatorAppliedRequest,
  HcmSimulatorBalance,
  HcmSimulatorConfig,
  RequestEvent,
  TimeOffRequest,
};
