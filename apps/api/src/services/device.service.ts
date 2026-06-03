import { prisma } from '@alma/db';
import type { ReserveReservationStatus } from '@prisma/client';
import {
  adminVenueDeviceCreateInputSchema,
  adminVenueDeviceUpdateInputSchema,
  devicePinLoginInputSchema,
  staffHomePinLoginInputSchema,
  type AdminVenueDevicesPayload,
  type AuthUser,
  type DeviceStaffListResponse,
  type HomeOperationalSummary
} from '@alma/shared';
import { HttpError } from '../lib/http.js';
import { authService } from './auth.service.js';

const DEVICE_APP_ACCESS = [
  { appId: 'GIFTCARDS' as const, role: 'USER', permissions: { view: true, redeem: true } },
  { appId: 'STOCK' as const, role: 'USER', permissions: { view: true, stocktake: true } },
  { appId: 'RESERVE' as const, role: 'USER', permissions: { view: true } },
  { appId: 'STAFF' as const, role: 'USER', permissions: { view: true, rosterView: true } },
  { appId: 'COMPLIANCE' as const, role: 'USER', permissions: { view: true, checklists: true, create: true } }
];
const PIN_FAILURE_LIMIT = 5;
const PIN_LOCK_MS = 5 * 60 * 1000;
const PIN_LOGIN_FAILED_MESSAGE = 'PIN login failed';

// Per-IP throttle for the PUBLIC, un-authenticated staff-pin-login endpoint.
// Without it, anyone could brute-force PINs across all staff. In-memory and
// therefore per-instance — a meaningful bar on the common single-instance case;
// a shared store would harden it further across scaled-out instances.
const PIN_IP_WINDOW_MS = 15 * 60 * 1000;
const PIN_IP_MAX_FAILURES = 10;
const pinAttemptsByIp = new Map<string, { failures: number; firstAt: number; lockedUntil: number }>();

function pinRateKey(ip: string | undefined): string {
  return ip && ip.trim() ? ip.trim() : 'unknown';
}

function assertPinLoginRateOk(ip: string | undefined): void {
  const now = Date.now();
  // Opportunistic cleanup so the map can't grow without bound under attack.
  if (pinAttemptsByIp.size > 5000) {
    for (const [key, rec] of pinAttemptsByIp) {
      if (rec.lockedUntil < now && now - rec.firstAt > PIN_IP_WINDOW_MS) pinAttemptsByIp.delete(key);
    }
  }
  const rec = pinAttemptsByIp.get(pinRateKey(ip));
  if (rec && rec.lockedUntil > now) {
    throw new HttpError(429, 'Too many PIN attempts. Wait a few minutes and try again.');
  }
}

function recordPinLoginFailure(ip: string | undefined): void {
  const key = pinRateKey(ip);
  const now = Date.now();
  const rec = pinAttemptsByIp.get(key);
  if (!rec || now - rec.firstAt > PIN_IP_WINDOW_MS) {
    pinAttemptsByIp.set(key, { failures: 1, firstAt: now, lockedUntil: 0 });
    return;
  }
  rec.failures += 1;
  if (rec.failures >= PIN_IP_MAX_FAILURES) {
    rec.lockedUntil = now + PIN_IP_WINDOW_MS;
  }
}

function recordPinLoginSuccess(ip: string | undefined): void {
  pinAttemptsByIp.delete(pinRateKey(ip));
}

function displayName(profile: { firstName: string; lastName: string; email?: string | null }) {
  return `${profile.firstName ?? ''} ${profile.lastName ?? ''}`.trim() || profile.email || 'Venue device';
}

function nameParts(value: string) {
  const parts = value.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0] ?? 'Venue', lastName: 'iPad' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1) ?? 'iPad' };
}

function normaliseVenue(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase();
}

function dayWindow(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

async function recordPinFailure(profile: { id: string; pinFailedAttempts: number }) {
  const failedAttempts = profile.pinFailedAttempts + 1;
  await prisma.staffProfile.update({
    where: { id: profile.id },
    data: {
      pinFailedAttempts: failedAttempts,
      pinLastFailedAt: new Date(),
      pinLockedUntil: failedAttempts >= PIN_FAILURE_LIMIT ? new Date(Date.now() + PIN_LOCK_MS) : null
    }
  });
}

async function resetPinFailures(staffProfileId: string) {
  await prisma.staffProfile.update({
    where: { id: staffProfileId },
    data: {
      pinFailedAttempts: 0,
      pinLockedUntil: null,
      pinLastFailedAt: null
    }
  });
}

function requireDeviceAccount(user: AuthUser | undefined | null): AuthUser {
  if (!user || user.accountType !== 'VENUE_DEVICE') {
    throw new HttpError(403, 'Venue device account required.');
  }
  if (!user.venue) {
    throw new HttpError(403, 'Venue device account is missing a venue.');
  }
  return user;
}

function staffOption(profile: {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  roleTitle: string;
  venue: string | null;
  pinHash: string | null;
}) {
  return {
    id: profile.id,
    name: displayName(profile),
    email: profile.email,
    roleTitle: profile.roleTitle,
    venue: profile.venue,
    hasPin: Boolean(profile.pinHash)
  };
}

function appAccessPayload(access: {
  id: string;
  staffProfileId: string;
  appId: any;
  status: any;
  role: string;
  permissions: unknown;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const permissions: Record<string, boolean> =
    access.permissions && typeof access.permissions === 'object' && !Array.isArray(access.permissions)
      ? Object.fromEntries(
          Object.entries(access.permissions as Record<string, unknown>).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')
        )
      : {};
  return {
    ...access,
    createdAt: access.createdAt.toISOString(),
    updatedAt: access.updatedAt.toISOString(),
    permissions
  };
}

export const deviceService = {
  async listVenueDevices(): Promise<AdminVenueDevicesPayload> {
    const devices = await prisma.staffProfile.findMany({
      where: {
        accountType: 'VENUE_DEVICE',
        mergedIntoStaffProfileId: null,
        NOT: { employmentStatus: 'ARCHIVED' }
      },
      orderBy: [{ venue: 'asc' }, { firstName: 'asc' }],
      include: { appAccess: { orderBy: [{ appId: 'asc' }] } }
    });

    return {
      generatedAt: new Date().toISOString(),
      devices: devices.map((device) => ({
        id: device.id,
        displayName: displayName(device),
        email: device.email,
        venue: device.venue,
        employmentStatus: device.employmentStatus,
        enabled: device.employmentStatus === 'ACTIVE',
        hasPassword: Boolean(device.passwordHash),
        lastLoginAt: device.lastLoginAt?.toISOString() ?? null,
        createdAt: device.createdAt.toISOString(),
        updatedAt: device.updatedAt.toISOString(),
        appAccess: device.appAccess.map(appAccessPayload)
      }))
    };
  },

  async createVenueDevice(input: unknown, actor?: AuthUser | null) {
    const data = adminVenueDeviceCreateInputSchema.parse(input);
    const email = data.email.trim().toLowerCase();
    const existing = await prisma.staffProfile.findUnique({ where: { email } });
    if (existing) throw new HttpError(409, 'An account already exists for that email.');
    const parts = nameParts(data.displayName);

    const device = await prisma.staffProfile.create({
      data: {
        ...parts,
        email,
        venue: data.venue,
        roleTitle: 'Venue iPad',
        employmentStatus: data.enabled ? 'ACTIVE' : 'DISABLED',
        accountType: 'VENUE_DEVICE',
        appAccess: {
          create: DEVICE_APP_ACCESS.map((access) => ({
            appId: access.appId,
            status: 'ENABLED',
            role: access.role,
            permissions: access.permissions,
            notes: 'Default shared venue iPad access.'
          }))
        }
      },
      include: { appAccess: { orderBy: [{ appId: 'asc' }] } }
    });

    await prisma.staffManagementEvent.create({
      data: {
        staffProfileId: device.id,
        eventType: 'VENUE_DEVICE_CREATED',
        summary: 'Venue iPad account created.',
        createdById: actor?.id ?? null,
        createdByName: actor ? displayName(actor) : null,
        createdByEmail: actor?.email ?? null,
        metadata: { venue: device.venue, email: device.email }
      }
    });

    return (await this.listVenueDevices()).devices.find((entry) => entry.id === device.id);
  },

  async updateVenueDevice(id: string, input: unknown, actor?: AuthUser | null) {
    const data = adminVenueDeviceUpdateInputSchema.parse(input);
    const existing = await prisma.staffProfile.findFirst({
      where: { id, accountType: 'VENUE_DEVICE', mergedIntoStaffProfileId: null }
    });
    if (!existing) throw new HttpError(404, 'Venue device account not found.');
    if (data.email) {
      const email = data.email.trim().toLowerCase();
      const duplicate = await prisma.staffProfile.findFirst({ where: { email, NOT: { id } } });
      if (duplicate) throw new HttpError(409, 'An account already exists for that email.');
    }

    const name = data.displayName ? nameParts(data.displayName) : {};
    await prisma.staffProfile.update({
      where: { id },
      data: {
        ...name,
        email: data.email?.trim().toLowerCase(),
        venue: data.venue,
        employmentStatus: typeof data.enabled === 'boolean' ? (data.enabled ? 'ACTIVE' : 'DISABLED') : undefined
      }
    });

    await prisma.staffManagementEvent.create({
      data: {
        staffProfileId: id,
        eventType: 'VENUE_DEVICE_UPDATED',
        summary: 'Venue iPad account updated.',
        createdById: actor?.id ?? null,
        createdByName: actor ? displayName(actor) : null,
        createdByEmail: actor?.email ?? null,
        metadata: { fields: Object.keys(data) }
      }
    });

    return (await this.listVenueDevices()).devices.find((entry) => entry.id === id);
  },

  async listDeviceStaff(deviceUser: AuthUser, activeUser?: AuthUser | null): Promise<DeviceStaffListResponse> {
    const device = requireDeviceAccount(deviceUser);
    const staffWhere = {
      accountType: 'HUMAN' as const,
      employmentStatus: 'ACTIVE' as const,
      mergedIntoStaffProfileId: null,
      venue: device.venue
    };
    const [staff, clockedIn] = await Promise.all([
      prisma.staffProfile.findMany({
        where: staffWhere,
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          roleTitle: true,
          venue: true,
          pinHash: true
        }
      }),
      prisma.staffClockSession.findMany({
        where: {
          status: 'OPEN',
          clockOutAt: null,
          venue: device.venue,
          staffProfile: staffWhere
        },
        orderBy: [{ clockInAt: 'asc' }],
        include: {
          staffProfile: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              roleTitle: true,
              venue: true
            }
          }
        }
      })
    ]);
    return {
      venue: device.venue,
      activeUser: activeUser ?? null,
      staff: staff.map(staffOption),
      clockedIn: clockedIn.map((session) => ({
        sessionId: session.id,
        staffProfileId: session.staffProfileId,
        name: displayName(session.staffProfile),
        roleTitle: session.roleTitle ?? session.staffProfile.roleTitle,
        venue: session.venue ?? session.staffProfile.venue,
        clockInAt: session.clockInAt.toISOString()
      }))
    };
  },

  async listPinStaff() {
    const staff = await prisma.staffProfile.findMany({
      where: {
        accountType: 'HUMAN',
        employmentStatus: 'ACTIVE',
        mergedIntoStaffProfileId: null
      },
      orderBy: [{ venue: 'asc' }, { firstName: 'asc' }, { lastName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        roleTitle: true,
        venue: true,
        pinHash: true
      }
    });

    return {
      generatedAt: new Date().toISOString(),
      staff: staff.map((profile) => ({
        ...staffOption(profile),
        email: null
      }))
    };
  },

  async homeSummary(): Promise<HomeOperationalSummary> {
    const now = new Date();
    const { start, end } = dayWindow(now);
    const weekAhead = new Date(now);
    weekAhead.setDate(weekAhead.getDate() + 7);
    const inactiveReservationStatuses: ReserveReservationStatus[] = ['CANCELLED', 'NO_SHOW'];
    const activeReservationStatus = { notIn: inactiveReservationStatuses };

    const [
      bookingsToday,
      coversToday,
      upcomingBookings,
      nextBooking,
      clockedInNow,
      rosteredToday,
      optedInContacts,
      scheduledCampaigns,
      scheduledPosts
    ] = await Promise.all([
      prisma.reserveReservation.count({
        where: {
          startsAt: { gte: start, lt: end },
          status: activeReservationStatus
        }
      }),
      prisma.reserveReservation.aggregate({
        _sum: { covers: true },
        where: {
          startsAt: { gte: start, lt: end },
          status: activeReservationStatus
        }
      }),
      prisma.reserveReservation.count({
        where: {
          startsAt: { gte: now, lt: weekAhead },
          status: activeReservationStatus
        }
      }),
      prisma.reserveReservation.findFirst({
        where: {
          startsAt: { gte: now },
          status: activeReservationStatus
        },
        orderBy: [{ startsAt: 'asc' }],
        select: { startsAt: true, venue: true, covers: true }
      }),
      prisma.staffClockSession.count({
        where: {
          status: 'OPEN',
          clockOutAt: null
        }
      }),
      prisma.rosterShift.count({
        where: {
          startsAt: { gte: start, lt: end },
          status: { not: 'CANCELLED' }
        }
      }),
      prisma.marketingContact.count({
        where: {
          OR: [{ consentEmail: true }, { consentSms: true }]
        }
      }),
      prisma.marketingCampaign.count({
        where: {
          status: 'SCHEDULED',
          scheduledFor: { gte: now }
        }
      }),
      prisma.marketingContentPost.count({
        where: {
          status: 'SCHEDULED',
          scheduledAt: { gte: now }
        }
      })
    ]);

    return {
      generatedAt: now.toISOString(),
      bookings: {
        today: bookingsToday,
        upcoming: upcomingBookings,
        coversToday: coversToday._sum?.covers ?? 0,
        next: nextBooking
          ? {
              startsAt: nextBooking.startsAt.toISOString(),
              venue: nextBooking.venue,
              covers: nextBooking.covers
            }
          : null
      },
      staff: {
        clockedInNow,
        rosteredToday
      },
      marketing: {
        optedInContacts,
        scheduledCampaigns,
        scheduledPosts
      }
    };
  },

  async pinLogin(deviceUser: AuthUser, input: unknown) {
    const device = requireDeviceAccount(deviceUser);
    const data = devicePinLoginInputSchema.parse(input);
    const profile = await prisma.staffProfile.findFirst({
      where: {
        id: data.staffProfileId,
        accountType: 'HUMAN',
        employmentStatus: 'ACTIVE',
        mergedIntoStaffProfileId: null
      },
      select: {
        id: true,
        venue: true,
        pinHash: true,
        pinFailedAttempts: true,
        pinLockedUntil: true
      }
    });
    if (!profile || !profile.pinHash || normaliseVenue(profile.venue) !== normaliseVenue(device.venue)) {
      throw new HttpError(401, PIN_LOGIN_FAILED_MESSAGE);
    }
    if (profile.pinLockedUntil && profile.pinLockedUntil.getTime() > Date.now()) {
      throw new HttpError(401, PIN_LOGIN_FAILED_MESSAGE);
    }
    const ok = await authService.comparePin(data.pin, profile.pinHash);
    if (!ok) {
      await recordPinFailure(profile);
      throw new HttpError(401, PIN_LOGIN_FAILED_MESSAGE);
    }
    const staffUser = await authService.getActiveHumanById(profile.id);
    if (!staffUser) throw new HttpError(401, PIN_LOGIN_FAILED_MESSAGE);
    await resetPinFailures(profile.id);
    return authService.effectiveDeviceUser(device, staffUser);
  },

  async staffPinLogin(input: unknown, clientIp?: string, deviceVenue?: string | null) {
    const data = staffHomePinLoginInputSchema.parse(input);
    assertPinLoginRateOk(clientIp);
    const profiles = await prisma.staffProfile.findMany({
      where: {
        accountType: 'HUMAN',
        employmentStatus: 'ACTIVE',
        mergedIntoStaffProfileId: null,
        pinHash: { not: null },
        // Match the kiosk list scope when the device venue is known.
        ...(deviceVenue ? { venue: deviceVenue } : {})
      },
      select: {
        id: true,
        pinHash: true,
        pinFailedAttempts: true,
        pinLockedUntil: true
      }
    });

    const matches = [];
    for (const profile of profiles) {
      if (profile.pinHash && await authService.comparePin(data.pin, profile.pinHash)) {
        matches.push(profile);
      }
    }

    if (matches.length === 0) {
      recordPinLoginFailure(clientIp);
      throw new HttpError(401, PIN_LOGIN_FAILED_MESSAGE);
    }
    if (matches.length > 1) {
      recordPinLoginFailure(clientIp);
      throw new HttpError(409, 'That PIN is linked to more than one staff profile. Ask a manager to reset one PIN.');
    }
    const profile = matches[0]!;
    if (profile.pinLockedUntil && profile.pinLockedUntil.getTime() > Date.now()) {
      recordPinLoginFailure(clientIp);
      throw new HttpError(401, PIN_LOGIN_FAILED_MESSAGE);
    }
    const staffUser = await authService.getActiveHumanById(profile.id);
    if (!staffUser) {
      recordPinLoginFailure(clientIp);
      throw new HttpError(401, PIN_LOGIN_FAILED_MESSAGE);
    }
    recordPinLoginSuccess(clientIp);
    await resetPinFailures(profile.id);
    await prisma.staffProfile.update({
      where: { id: profile.id },
      data: { lastLoginAt: new Date() }
    });
    return staffUser;
  }
};
