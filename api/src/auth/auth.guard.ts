import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { createHash } from 'crypto';

import { SupabaseService } from '../supabase/supabase.service';
import { getMetaString, getUnkeyPrincipalFromRequest } from './unkey-principal';
import type { RequestUser } from './user.interface';

declare module 'express' {
  interface Request {
    user?: RequestUser;
    planType?: string;
  }
}

type TokenValidationResult = {
  isAuthenticated: boolean;
  userId?: string;
  projectId?: string;
  keyId?: string;
  teamId?: string;
  planType?: string;
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private supabaseService: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request) {
      throw new UnauthorizedException('Request object not available.');
    }

    return this.validateRequest(request);
  }

  private async validateRequest(request: Request): Promise<boolean> {
    try {
      const validationResult =
        process.env.SELF_HOSTED === 'true'
          ? await this.getAuthenticationFromSelfHostedKey(request)
          : this.getAuthenticationFromPrincipal(request);

      if (!validationResult.isAuthenticated) {
        throw new UnauthorizedException('Invalid or missing API key');
      }

      const { userId, projectId, keyId, teamId, planType } = validationResult;

      this.supabaseService.setUser(userId!);

      request.user = {
        id: userId!,
        projectId: projectId!,
        apiKey: keyId || '',
        teamId: teamId || '',
      };
      request.planType = planType;

      return true;
    } catch (error: unknown) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Authentication failed.');
    }
  }

  private async getAuthenticationFromSelfHostedKey(
    request: Request,
  ): Promise<TokenValidationResult> {
    const authorization = request.headers.authorization;
    const headerApiKey = request.headers['x-post-for-me-api-key'];
    const rawHeaderApiKey = Array.isArray(headerApiKey)
      ? headerApiKey[0]
      : headerApiKey;

    const bearerKey =
      typeof authorization === 'string' && authorization.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length).trim()
        : undefined;
    const apiKey = bearerKey || rawHeaderApiKey?.trim();

    if (!apiKey) {
      return { isAuthenticated: false };
    }

    const keyHash = createHash('sha256').update(apiKey).digest('hex');
    const { data, error } = await (this.supabaseService.supabaseServiceRole as any)
      .from('self_hosted_api_keys')
      .select('id, project_id, team_id, created_by, enabled, expires_at')
      .eq('key_hash', keyHash)
      .eq('enabled', true)
      .maybeSingle();

    if (error || !data) {
      return { isAuthenticated: false };
    }

    if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
      return { isAuthenticated: false };
    }

    return {
      isAuthenticated: true,
      userId: data.created_by,
      projectId: data.project_id,
      keyId: data.id,
      teamId: data.team_id,
      planType: 'self_hosted',
    };
  }

  private getAuthenticationFromPrincipal(
    request: Request,
  ): TokenValidationResult {
    const principal = getUnkeyPrincipalFromRequest(request);

    if (!principal || principal.type !== 'API_KEY') {
      return { isAuthenticated: false };
    }

    const keyMeta = principal.source?.key?.meta;
    const userId = getMetaString(keyMeta, 'created_by');
    const projectId = principal.identity?.externalId;
    const keyId = principal.source?.key?.keyId;
    const teamId = getMetaString(keyMeta, 'team_id');
    const planType = getMetaString(keyMeta, 'plan_type');

    if (!userId || !projectId) {
      return { isAuthenticated: false };
    }

    return {
      isAuthenticated: true,
      userId,
      projectId,
      keyId,
      teamId,
      planType,
    };
  }
}
