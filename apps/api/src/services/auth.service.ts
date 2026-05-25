import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@alma/db';
import {
  authChangePasswordSchema,
  authLoginSchema,
  authPasswordResetCompleteSchema,
  authPasswordResetRequestSchema,
  type AuthUser
} from '@alma/shared';
import { HttpError } from '../lib/http.js';
import { mailService } from './mail.service.js';

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
  const complianceAccess = profile.appAccess.find(
    (access) => access.appId === 'COMPLIANCE' && access.status === 'ENABLED'
  );
  const accessRole = complianceAccess?.role?.toUpperCase() ?? '';
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

function intersectAppAccess(staffUser: AuthUser, deviceUser: AuthUser): AuthUser['appAccess'] {
  return staffUser.appAccess.flatMap((staffAccess) => {
    const deviceAccess = deviceUser.appAccess.find((access) => access.appId === staffAccess.appId);
    if (!deviceAccess || staffAccess.status !== 'ENABLED' || deviceAccess.status !== 'ENABLED') return [];
    const staffPermissions = staffAccess.permissions ?? {};
    const devicePermissions = deviceAccess.permissions ?? {};
    const permissions = Object.fromEntries(
      Object.entries(staffPermissions).filter(([key, allowed]) => allowed && devicePermissions[key] === true)
    );
    return [{
      appId: staffAccess.appId,
      status: 'ENABLED' as const,
      role: staffAccess.role === 'ADMIN' || deviceAccess.role === 'ADMIN'
        ? (staffAccess.role === 'ADMIN' && deviceAccess.role === 'ADMIN' ? 'ADMIN' : 'USER')
        : staffAccess.role === 'MANAGER' && deviceAccess.role === 'MANAGER'
          ? 'MANAGER'
          : 'USER',
      permissions
    }];
  });
}

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const PASSWORD_RESET_COOLDOWN_MS = 2 * 60 * 1000;
export const PASSWORD_RESET_GENERIC_MESSAGE = 'If an account exists for that email, a reset link has been sent.';

function normaliseEmail(value: string | null | undefined) {
  const email = value?.trim().toLowerCase();
  return email || null;
}

function hashResetToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function parseOriginList(value: string | undefined) {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function allowedResetOrigins(requestOrigin?: string | null) {
  const origins = new Set<string>();
  [
    process.env.FRONTEND_URL,
    process.env.COMPLIANCE_WEB_URL,
    process.env.STAFF_WEB_URL,
    process.env.VITE_COMPLIANCE_WEB_URL,
    process.env.VITE_STAFF_WEB_URL
  ].forEach((value) => {
    if (!value) return;
    try {
      origins.add(new URL(value).origin);
    } catch {
      // Ignore non-URL env entries.
    }
  });
  for (const value of parseOriginList(process.env.CORS_ORIGIN)) {
    try {
      origins.add(new URL(value).origin);
    } catch {
      // Ignore malformed CORS entries.
    }
  }
  if (process.env.NODE_ENV !== 'production') {
    if (requestOrigin) {
      try {
        origins.add(new URL(requestOrigin).origin);
      } catch {
        // Ignore malformed local Origin headers.
      }
    }
    [
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:5175',
      'http://localhost:5176',
      'http://localhost:5178',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5174',
      'http://127.0.0.1:5175',
      'http://127.0.0.1:5176',
      'http://127.0.0.1:5178'
    ].forEach((origin) => origins.add(origin));
  }
  return origins;
}

function resetBaseUrl(input: string | undefined, requestOrigin?: string | null) {
  const candidate =
    input?.trim() ||
    process.env.PASSWORD_RESET_BASE_URL ||
    process.env.COMPLIANCE_WEB_URL ||
    process.env.STAFF_WEB_URL ||
    '';
  if (!candidate) {
    throw new HttpError(400, 'Password reset URL is not configured.');
  }

  const url = new URL(candidate);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new HttpError(400, 'Password reset URL must be HTTP or HTTPS.');
  }
  if (!allowedResetOrigins(requestOrigin).has(url.origin)) {
    throw new HttpError(400, 'Password reset URL is not an allowed app origin.');
  }
  return url;
}

function resetLinkFor(token: string, baseUrl: URL) {
  const url = new URL(baseUrl.toString());
  url.searchParams.set('token', token);
  return url.toString();
}

type PasswordResetContext = {
  requestOrigin?: string | null;
  requestIp?: string | null;
  userAgent?: string | null;
  requestedBy?: AuthUser | null;
};

type PasswordResetResult = {
  accountExists: boolean;
  deliveryStatus: 'sent' | 'skipped' | 'failed' | 'cooldown' | 'no_account';
  deliveryReason?: string;
};

export const authService = {
  async hashPassword(plain: string) {
    return bcrypt.hash(plain, 10);
  },

  async hashPin(pin: string) {
    return bcrypt.hash(pin, 10);
  },

  async comparePin(pin: string, pinHash: string) {
    return bcrypt.compare(pin, pinHash);
  },

  effectiveDeviceUser(deviceUser: AuthUser, staffUser: AuthUser): AuthUser {
    return {
      ...staffUser,
      isAdmin: false,
      role: 'STAFF',
      venue: deviceUser.venue,
      appAccess: intersectAppAccess(staffUser, deviceUser),
      deviceAccount: {
        id: deviceUser.id,
        name: `${deviceUser.firstName} ${deviceUser.lastName}`.trim() || deviceUser.email || 'Venue device',
        venue: deviceUser.venue
      }
    };
  },

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
  },

  async getActiveHumanById(userId: string): Promise<AuthUser | null> {
    const profile = await prisma.staffProfile.findFirst({
      where: {
        id: userId,
        accountType: 'HUMAN',
        employmentStatus: 'ACTIVE',
        mergedIntoStaffProfileId: null
      },
      include: {
        appAccess: {
          select: { appId: true, status: true, role: true, permissions: true }
        }
      }
    });
    if (!profile) return null;
    return toAuthUser(profile);
  },

  async changePassword(userId: string, input: unknown) {
    const { currentPassword, newPassword } = authChangePasswordSchema.parse(input);
    const profile = await prisma.staffProfile.findUnique({ where: { id: userId } });
    if (!profile || !profile.passwordHash) {
      throw new HttpError(404, 'User not found');
    }

    const ok = await bcrypt.compare(currentPassword, profile.passwordHash);
    if (!ok) {
      throw new HttpError(401, 'Current password is incorrect');
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.staffProfile.update({
      where: { id: userId },
      data: { passwordHash }
    });
  },

  async requestPasswordReset(input: unknown, context: PasswordResetContext = {}) {
    const data = authPasswordResetRequestSchema.parse(input);
    return this.requestPasswordResetForEmail(data.email, {
      ...context,
      resetBaseUrl: data.resetBaseUrl || undefined,
      appName: data.appName || undefined
    });
  },

  async requestPasswordResetForEmail(
    emailInput: string,
    options: PasswordResetContext & {
      resetBaseUrl?: string;
      appName?: string;
    } = {}
  ): Promise<PasswordResetResult> {
    const email = normaliseEmail(emailInput);
    if (!email) {
      console.info('[auth] password-reset: blank email input');
      return { accountExists: false, deliveryStatus: 'no_account' };
    }
    const resetUrl = resetBaseUrl(options.resetBaseUrl, options.requestOrigin);

    const profile = await prisma.staffProfile.findUnique({ where: { email } });
    if (!profile) {
      console.info('[auth] password-reset: no profile found', { email });
      return { accountExists: false, deliveryStatus: 'no_account' };
    }
    if (profile.mergedIntoStaffProfileId) {
      console.info('[auth] password-reset: profile is merged', { email, profileId: profile.id });
      return { accountExists: false, deliveryStatus: 'no_account' };
    }
    if (profile.accountType === 'VENUE_DEVICE') {
      console.info('[auth] password-reset: VENUE_DEVICE account', { email, profileId: profile.id });
      return { accountExists: false, deliveryStatus: 'no_account' };
    }
    if (!profile.email) {
      console.info('[auth] password-reset: profile has no email', { profileId: profile.id });
      return { accountExists: false, deliveryStatus: 'no_account' };
    }

    const recentToken = await prisma.staffPasswordResetToken.findFirst({
      where: {
        staffProfileId: profile.id,
        usedAt: null,
        createdAt: { gte: new Date(Date.now() - PASSWORD_RESET_COOLDOWN_MS) }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (recentToken) {
      console.info('[auth] password-reset: cooldown active', { email, profileId: profile.id });
      return { accountExists: true, deliveryStatus: 'cooldown' };
    }

    console.info('[auth] password-reset: creating token and sending email', { email, profileId: profile.id });

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
    const resetLink = resetLinkFor(token, resetUrl);

    await prisma.staffPasswordResetToken.create({
      data: {
        staffProfileId: profile.id,
        tokenHash: hashResetToken(token),
        requestedById: options.requestedBy?.id ?? null,
        requestedByName: options.requestedBy
          ? `${options.requestedBy.firstName ?? ''} ${options.requestedBy.lastName ?? ''}`.trim() || options.requestedBy.email
          : null,
        requestedByEmail: options.requestedBy?.email ?? null,
        requestIp: options.requestIp ?? null,
        userAgent: options.userAgent?.slice(0, 500) ?? null,
        expiresAt
      }
    });

    const delivery = await mailService.sendPasswordReset({
      to: profile.email!,
      firstName: profile.firstName,
      resetLink,
      expiresAt,
      appName: options.appName
    });

    if (delivery.status !== 'sent') {
      console.error('[auth] Password reset email not delivered', {
        profileId: profile.id,
        email: profile.email,
        deliveryStatus: delivery.status,
        reason: 'reason' in delivery ? delivery.reason : undefined
      });
    }

    return {
      accountExists: true,
      deliveryStatus: delivery.status,
      deliveryReason: 'reason' in delivery ? delivery.reason : undefined
    };
  },

  async completePasswordReset(input: unknown) {
    const data = authPasswordResetCompleteSchema.parse(input);
    const tokenHash = hashResetToken(data.token);
    const resetToken = await prisma.staffPasswordResetToken.findUnique({
      where: { tokenHash },
      include: { staffProfile: true }
    });

    if (!resetToken || resetToken.usedAt || resetToken.expiresAt.getTime() <= Date.now()) {
      throw new HttpError(400, 'This password reset link is invalid or has expired.');
    }

    const passwordHash = await bcrypt.hash(data.newPassword, 10);
    await prisma.$transaction([
      prisma.staffProfile.update({
        where: { id: resetToken.staffProfileId },
        data: { passwordHash }
      }),
      prisma.staffPasswordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() }
      }),
      prisma.staffPasswordResetToken.updateMany({
        where: {
          staffProfileId: resetToken.staffProfileId,
          id: { not: resetToken.id },
          usedAt: null
        },
        data: { usedAt: new Date() }
      })
    ]);
  },

  async hasAnyAdmins() {
    const count = await prisma.staffProfile.count({ where: { isAdmin: true } });
    return count > 0;
  }
};
