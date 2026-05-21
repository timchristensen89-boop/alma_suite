import bcrypt from 'bcryptjs';
import { prisma } from '@alma/db';
import { authLoginSchema, type AuthUser } from '@alma/shared';
import { HttpError } from '../lib/http.js';

function permissionRecord(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, allowed]) => typeof allowed === 'boolean')
  ) as Record<string, boolean>;
}

function toAuthUser(profile: {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  roleTitle: string;
  venue: string | null;
  accountType?: 'HUMAN' | 'VENUE_DEVICE';
  isAdmin: boolean;
  appAccess: Array<Pick<AuthUser['appAccess'][number], 'appId' | 'status' | 'role'> & { permissions: unknown }>;
}): AuthUser {
  const accountType = profile.accountType ?? 'HUMAN';
  const stockAccess = profile.appAccess.find(
    (access) => access.appId === 'STOCK' && access.status === 'ENABLED'
  );
  const accessRole = stockAccess?.role?.toUpperCase() ?? '';
  const isManager =
    accountType === 'HUMAN' &&
    (
      profile.isAdmin ||
      accessRole === 'ADMIN' ||
      accessRole === 'MANAGER' ||
      /manager|supervisor|lead|owner|admin/i.test(profile.roleTitle)
    );

  return {
    id: profile.id,
    firstName: profile.firstName,
    lastName: profile.lastName,
    email: profile.email,
    roleTitle: profile.roleTitle,
    venue: profile.venue,
    accountType,
    isAdmin: accountType === 'HUMAN' ? profile.isAdmin : false,
    role: accountType === 'HUMAN' && profile.isAdmin ? 'ADMIN' : isManager ? 'MANAGER' : 'STAFF',
    appAccess: profile.appAccess.map((access) => ({
      appId: access.appId,
      status: access.status,
      role: access.role,
      permissions: permissionRecord(access.permissions)
    }))
  };
}

export const authService = {
  async login(input: unknown) {
    const { email, password } = authLoginSchema.parse(input);

    const profile = await prisma.staffProfile.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        appAccess: {
          select: { appId: true, status: true, role: true, permissions: true }
        }
      }
    });

    if (!profile || !profile.passwordHash) {
      throw new HttpError(401, 'Email or password is incorrect');
    }
    if (profile.accountType === 'VENUE_DEVICE' && profile.employmentStatus !== 'ACTIVE') {
      throw new HttpError(401, 'Email or password is incorrect');
    }

    const ok = await bcrypt.compare(password, profile.passwordHash);
    if (!ok) {
      throw new HttpError(401, 'Email or password is incorrect');
    }

    await prisma.staffProfile.update({
      where: { id: profile.id },
      data: { lastLoginAt: new Date() }
    });

    return toAuthUser(profile);
  },

  async getById(userId: string): Promise<AuthUser | null> {
    const profile = await prisma.staffProfile.findUnique({
      where: { id: userId },
      include: {
        appAccess: {
          select: { appId: true, status: true, role: true, permissions: true }
        }
      }
    });
    if (!profile) return null;
    return toAuthUser(profile);
  }
};
