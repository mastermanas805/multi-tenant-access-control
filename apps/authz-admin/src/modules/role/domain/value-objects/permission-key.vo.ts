/**
 * A role grants a set of permission keys (`service:resource:action`, DESIGN §3,
 * FR-4). The key invariant is OWNED by the permission catalog domain — promoting
 * it there removed a duplicated VO that had DIVERGENT validation rules (one
 * allowed `_`, the other `*`), which let a catalog key be rejected as a role
 * grant and vice versa.
 *
 * This module now re-exports the SINGLE canonical VO so a key valid in the
 * catalog is always valid as a role grant, with one shared grammar and one shared
 * error reason code.
 */
export {
  PermissionKey,
  PERMISSION_KEY_FORMAT_REASON,
} from '../../../permission/domain/value-objects/permission-key.vo';
