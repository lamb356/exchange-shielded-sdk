/**
 * Compliance Module
 *
 * Exports all compliance-related functionality including audit logging
 * and compliance management.
 *
 * @packageDocumentation
 */

// Audit Logger exports
export {
  AuditLogger,
  AuditEventType,
  AuditSeverity,
  createAuditLogger,
  getDefaultSeverity,
  isShieldedPrefix,
} from './audit-logger.js';

export type {
  AuditEvent,
  AuditFilter,
  ComplianceReport,
  AuditConfig,
} from './audit-logger.js';

// Compliance Manager exports
export {
  ComplianceManager,
  createComplianceManager,
} from './compliance.js';

export type {
  DateRange,
  ViewingKeyExport,
  ViewingKeyBundle,
  VelocityCheckResult,
  SuspiciousActivityFlag,
  VelocityThresholds,
  ComplianceConfig,
} from './compliance.js';
