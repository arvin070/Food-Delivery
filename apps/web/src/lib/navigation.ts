import { UserRole } from '@lunch/shared';

/**
 * Navigation and surface planning, as one source of truth.
 *
 * Two deliberately separate ideas:
 *
 *   `NAV_BY_ROLE`      — links in the header. Every href here MUST resolve to a
 *                        real page, on desktop and mobile alike.
 *   `PLANNED_SECTIONS` — areas a surface will gain as its module lands. These
 *                        are described, not linked, precisely because the routes
 *                        do not exist yet; a dead nav link is worse than none.
 *
 * When a module ships, move its entry from the second list to the first.
 */

export interface NavItem {
  href: string;
  label: string;
}

/** A part of a surface that is planned but not yet built. Not a link. */
export interface PlannedSection {
  label: string;
  description: string;
}

export const NAV_BY_ROLE: Record<UserRole, NavItem[]> = {
  CUSTOMER: [
    { href: '/meals', label: 'Browse meals' },
    { href: '/intelligence', label: 'Lunch assistant' },
    { href: '/institutions', label: 'Institutions' },
    { href: '/checkpoints', label: 'Checkpoints' },
    { href: '/corporate', label: 'Corporate meals' },
    { href: '/cart', label: 'Cart' },
    { href: '/children', label: 'My children' },
    { href: '/orders', label: 'My orders' },
    { href: '/tracking', label: 'Track meals' },
    { href: '/payments', label: 'Payments' },
    { href: '/subscriptions', label: 'Subscriptions' },
    { href: '/notifications', label: 'Notifications' },
    { href: '/support', label: 'Help' },
    { href: '/profile', label: 'Profile' },
  ],
  STUDENT: [
    { href: '/meals', label: 'Browse meals' },
    { href: '/intelligence', label: 'Lunch assistant' },
    { href: '/institutions', label: 'Institutions' },
    { href: '/checkpoints', label: 'Checkpoints' },
    { href: '/corporate', label: 'Corporate meals' },
    { href: '/cart', label: 'Cart' },
    { href: '/orders', label: 'My orders' },
    { href: '/tracking', label: 'Track meals' },
    { href: '/payments', label: 'Payments' },
    { href: '/subscriptions', label: 'Subscriptions' },
    { href: '/notifications', label: 'Notifications' },
    { href: '/support', label: 'Help' },
    { href: '/profile', label: 'Profile' },
  ],
  PARENT: [
    { href: '/meals', label: 'Browse meals' },
    { href: '/intelligence', label: 'Lunch assistant' },
    { href: '/institutions', label: 'Institutions' },
    { href: '/checkpoints', label: 'Checkpoints' },
    { href: '/corporate', label: 'Corporate meals' },
    { href: '/cart', label: 'Cart' },
    { href: '/children', label: 'My children' },
    { href: '/orders', label: 'My orders' },
    { href: '/tracking', label: 'Track meals' },
    { href: '/payments', label: 'Payments' },
    { href: '/subscriptions', label: 'Subscriptions' },
    { href: '/notifications', label: 'Notifications' },
    { href: '/support', label: 'Help' },
    { href: '/profile', label: 'Profile' },
  ],
  VENDOR: [
    { href: '/vendor', label: 'Dashboard' },
    { href: '/kitchen', label: 'Kitchen operations' },
    { href: '/vendor/orders', label: 'Orders' },
    { href: '/vendor/menu', label: 'Menu' },
    { href: '/vendor/availability', label: 'Availability' },
    { href: '/vendor/kitchen', label: 'Kitchen' },
    { href: '/notifications', label: 'Notifications' },
    { href: '/support', label: 'Help' },
    { href: '/profile', label: 'Profile' },
  ],
  DELIVERY_PARTNER: [
    { href: '/delivery', label: 'Deliveries' },
    { href: '/notifications', label: 'Notifications' },
    { href: '/support', label: 'Help' },
    { href: '/profile', label: 'Profile' },
  ],
  INSTITUTION_ADMIN: [
    { href: '/institution', label: 'Overview' },
    { href: '/admin/checkpoints', label: 'Checkpoints' },
    { href: '/notifications', label: 'Notifications' },
    { href: '/support', label: 'Help' },
    { href: '/profile', label: 'Profile' },
  ],
  SUPER_ADMIN: [
    { href: '/admin', label: 'Dashboard' },
    { href: '/admin/analytics', label: 'Analytics' },
    { href: '/admin/intelligence', label: 'Intelligence' },
    { href: '/institution', label: 'Institutions' },
    { href: '/corporate', label: 'Corporate meals' },
    { href: '/admin/vendors', label: 'Vendors' },
    { href: '/admin/routes', label: 'Delivery routes' },
    { href: '/admin/manage/orders', label: 'Orders' },
    { href: '/admin/manage/complaints', label: 'Complaints' },
    { href: '/admin/audit', label: 'Audit log' },
    { href: '/admin/checkpoints', label: 'Checkpoints' },
    { href: '/notifications', label: 'Notifications' },
    { href: '/support', label: 'Help' },
    { href: '/profile', label: 'Profile' },
  ],
};

export const PLANNED_SECTIONS: Record<UserRole, PlannedSection[]> = {
  CUSTOMER: [],
  STUDENT: [],
  PARENT: [],
  VENDOR: [],
  DELIVERY_PARTNER: [],
  INSTITUTION_ADMIN: [],
  SUPER_ADMIN: [],
};

export const ROLE_LABELS: Record<UserRole, string> = {
  CUSTOMER: 'Customer',
  PARENT: 'Parent',
  STUDENT: 'Student',
  VENDOR: 'Vendor',
  DELIVERY_PARTNER: 'Delivery partner',
  INSTITUTION_ADMIN: 'Institution admin',
  SUPER_ADMIN: 'Admin',
};

/** The four operational surfaces, for cross-linking from the admin shell. */
export const ROLE_SURFACES: { href: string; label: string }[] = [
  { href: '/meals', label: 'Customer' },
  { href: '/vendor', label: 'Vendor' },
  { href: '/delivery', label: 'Delivery partner' },
  { href: '/admin', label: 'Admin' },
];

export function navItemsFor(role: UserRole): NavItem[] {
  return NAV_BY_ROLE[role] ?? [];
}

export function plannedSectionsFor(role: UserRole): PlannedSection[] {
  return PLANNED_SECTIONS[role] ?? [];
}
