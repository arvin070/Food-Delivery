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
    { href: '/children', label: 'My children' },
    { href: '/orders', label: 'My orders' },
    { href: '/profile', label: 'Profile' },
  ],
  STUDENT: [
    { href: '/meals', label: 'Browse meals' },
    { href: '/orders', label: 'My orders' },
    { href: '/profile', label: 'Profile' },
  ],
  PARENT: [
    { href: '/meals', label: 'Browse meals' },
    { href: '/children', label: 'My children' },
    { href: '/orders', label: 'My orders' },
    { href: '/profile', label: 'Profile' },
  ],
  VENDOR: [
    { href: '/vendor', label: 'Kitchen' },
    { href: '/profile', label: 'Profile' },
  ],
  DELIVERY_PARTNER: [
    { href: '/delivery', label: 'Deliveries' },
    { href: '/profile', label: 'Profile' },
  ],
  INSTITUTION_ADMIN: [
    { href: '/institution', label: 'Overview' },
    { href: '/profile', label: 'Profile' },
  ],
  SUPER_ADMIN: [
    { href: '/admin', label: 'Admin' },
    { href: '/profile', label: 'Profile' },
  ],
};

export const PLANNED_SECTIONS: Record<UserRole, PlannedSection[]> = {
  CUSTOMER: [
    { label: 'Meal catalog', description: 'Browse published meals for a chosen date and checkpoint.' },
    { label: 'Cart and checkout', description: 'Review the basket, confirm slots and pay.' },
    { label: 'Order tracking', description: 'Live status from preparing through to delivered.' },
    { label: 'Subscriptions', description: 'Standing orders for recurring weekday meals.' },
  ],
  STUDENT: [
    { label: 'Meal catalog', description: 'Browse published meals for a chosen date and checkpoint.' },
    { label: 'Cart and checkout', description: 'Review the basket, confirm slots and pay.' },
    { label: 'Order tracking', description: 'Live status from preparing through to delivered.' },
  ],
  PARENT: [
    { label: 'Ordering for a child', description: 'Place an order on a child’s behalf, to their usual checkpoint.' },
    { label: 'Delivery confirmation', description: 'Notification the moment a meal is handed over.' },
    { label: 'Subscriptions', description: 'Recurring weekday meals per child.' },
  ],
  VENDOR: [
    { label: 'Menu management', description: 'Meals you offer, their components and pricing.' },
    { label: 'Publishing', description: 'Which meals are available on which dates and time slots.' },
    { label: 'Production queue', description: 'What to cook, grouped by slot and checkpoint.' },
    { label: 'Preparation and packing', description: 'Move each item through preparing, packed and dispatched.' },
  ],
  DELIVERY_PARTNER: [
    { label: 'Assigned runs', description: 'Today’s runs, each with its kitchen and time slot.' },
    { label: 'Checkpoint route', description: 'Stops in sequence, with arrival instructions.' },
    { label: 'Proof of delivery', description: 'Verify the recipient’s OTP and mark the meal delivered.' },
    { label: 'History', description: 'Completed runs and their delivery records.' },
  ],
  INSTITUTION_ADMIN: [
    { label: 'Checkpoint activity', description: 'Deliveries arriving at your institution today.' },
    { label: 'Members', description: 'Students and staff linked to this institution.' },
  ],
  SUPER_ADMIN: [
    { label: 'Users', description: 'Customers, parents, students and their account status.' },
    { label: 'Vendors and kitchens', description: 'Approvals, kitchens, service areas and commission.' },
    { label: 'Delivery partners', description: 'Riders, availability and assignment.' },
    { label: 'Orders and payments', description: 'Every order and payment across the platform.' },
    { label: 'Checkpoints and time slots', description: 'Delivery points, capacity and ordering cutoffs.' },
    { label: 'Analytics', description: 'Daily volume, fulfilment rate and demand by checkpoint.' },
  ],
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
