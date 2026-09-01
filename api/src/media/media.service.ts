import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createHash } from 'crypto';

import { SupabaseService } from '../supabase/supabase.service';
import { CreateUploadUrlResponseDto } from './dto/create-upload-url-response.dto';

@Injectable()
export class MediaService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) {}

  async createUploadUrl(
    projectId: string,
  ): Promise<CreateUploadUrlResponseDto> {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const configuredBaseStorageUrl =
      this.configService.get<string>('BASE_STORAGE_URL');

    if (!configuredBaseStorageUrl && !supabaseUrl) {
      throw new Error('SUPABASE_URL is not defined');
    }

    const baseStorageUrl =
      configuredBaseStorageUrl ||
      `${supabaseUrl}/storage/v1/object/public/post-media`;

    const randomString = randomBytes(8).toString('hex');
    const hash = createHash('sha256')
      .update(projectId + Date.now().toString() + randomString)
      .digest('hex')
      .slice(0, 24);

    const key = `${projectId}/${hash}`;
    const bucket = 'post-media';

    // The endpoint itself is authenticated and scoped to the caller's project.
    // Use the service role only for issuing the signed Storage upload URL so the
    // bucket does not need broad INSERT policies for browser clients.
    const signedUrl = await this.supabaseService.supabaseServiceRole.storage
      .from(bucket)
      .createSignedUploadUrl(key);

    if (signedUrl.error) throw signedUrl.error;
    if (!signedUrl.data) throw new Error('Signed URL not found');

    return {
      upload_url: signedUrl.data.signedUrl,
      media_url: `${baseStorageUrl.replace(/\/$/, '')}/${key}`,
    };
  }
}
