import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

import { KyselyService } from '../../../kysely/kysely.service';
import { StripeSyncService } from './stripe-sync.service';

@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly kysely: KyselyService,
    private readonly syncService: StripeSyncService,
  ) {
    const selfHosted =
      this.configService.get<string>('SELF_HOSTED') === 'true';
    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    const webhookSecret = this.configService.get<string>(
      'STRIPE_WEBHOOK_SECRET',
    );

    if (!selfHosted && !secretKey) {
      throw new Error('STRIPE_SECRET_KEY is not defined');
    }
    if (!selfHosted && !webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not defined');
    }

    this.stripe = new Stripe(secretKey || 'sk_self_hosted_disabled', {
      typescript: true,
      apiVersion: '2025-08-27.basil',
    });
    this.webhookSecret = webhookSecret || 'self_hosted_disabled';
  }

  constructEvent(rawBody: Buffer, signature: string): Stripe.Event {
    return this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      this.webhookSecret,
    );
  }

  async handleEvent(event: Stripe.Event): Promise<void> {
    try {
      await this.syncService.applyEvent(this.kysely.db, event);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to apply stripe event ${event.id} (${event.type}): ${message}`,
      );
      throw err;
    }
  }
}
