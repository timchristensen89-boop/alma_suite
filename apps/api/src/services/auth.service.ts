import bcrypt from 'bcryptjs';
import { prisma } from '@alma/db';
import { authChangePasswordSchema, authLoginSchema, type AuthUser } from '@alma/shared';
import { HttpError } from '../lib/http.js';

function toAuthUser(profile: {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  roleTitle: string;
  venue: string | null;
  isAdmin: boolean;
  appAccess: AuthUser['appAccess'];
}): AuthUser {
  const complianceAccess = profile.appAccess.find(
    (access) => access.appId === 'COMPLIANCE' && access.status === 'ENABLED'
  );
  const accessRole = complianceAccess?.role?.toUpperCase() ?? '';
  const isManager =
    profile.isAdmin ||
    accessRole === 'ADMIN' ||
    accessRole === 'MANAGER' ||
    /manager|supervisor|lead|owner|admin/i.test(profile.roleTitle);

  return {
    id: profile.id,
    firstName: profile.firstName,
    lastName: profile.lastName,
    email: profile.email,
    roleTitle: profile.roleTitle,
    venue: profile.venue,
    isAdmin: profile.isAdmin,
    role: profile.isAdmin ? 'ADMIN' : isManager ? 'MANAGER' : 'STAFF',
    appAccess: profile.appAccess.map((access) => ({
      appId: access.appId,
      status: access.status,
      role: access.role
    }))
  };
}

export const authService = {
  async hashPassword(plain: string) {
    return bcrypt.hash(plain, 10);
  },

  async login(input: unknown) {
    const { email, password } = authLoginSchema.parse(input);

    const profile = await prisma.staffProfile.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        appAccess: {
          select: { appId: true, status: true, role: true }
        }
      }
    });

    if (!profile || !profile.passwordHash) {
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
          select: { appId: true, status: true, role: true }
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

  async hasAnyAdmins() {
    const count = await prisma.staffProfile.count({ where: { isAdmin: true } });
    return count > 0;
  }
};
