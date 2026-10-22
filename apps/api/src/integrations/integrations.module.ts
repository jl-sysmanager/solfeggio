import { Global, Module } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';
import { Mailer } from './mailer.service';

@Global()
@Module({ providers: [IntegrationsService, Mailer], exports: [IntegrationsService, Mailer] })
export class IntegrationsModule {}
