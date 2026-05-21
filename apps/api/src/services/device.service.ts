import { prisma } from '@alma/db';
import {
  adminVenueDeviceCreateInputSchema,
  adminVenueDeviceUpdateInputSchema,
  devicePinLoginInputSchema,
  type AdminVenueDevicesPayload,
  type AuthUser,
  type DeviceStaffListResponse
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
    const staff = await prisma.staffProfile.findMany({
      where: {
        accountType: 'HUMAN',
        employmentStatus: 'ACTIVE',
        mergedIntoStaffProfileId: null,
        venue: device.venue
      },
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
    });
    return {
      venue: device.venue,
      activeUser: activeUser ?? null,
      staff: staff.map(staffOption)
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
        pinHash: true
      }
    });
    if (!profile || !profile.pinHash || normaliseVenue(profile.venue) !== normaliseVenue(device.venue)) {
      throw new HttpError(401, 'PIN login failed.');
    }
    const ok = await authService.comparePin(data.pin, profile.pinHash);
    if (!ok) throw new HttpError(401, 'PIN login failed.');
    const staffUser = await authService.getActiveHumanById(profile.id);
    if (!staffUser) throw new HttpError(401, 'PIN login failed.');
    return authService.effectiveDeviceUser(device, staffUser);
  }
};
