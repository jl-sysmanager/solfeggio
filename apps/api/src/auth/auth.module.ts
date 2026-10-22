import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { TokensService } from './tokens.service';

@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, SessionService, TokensService],
  exports: [AuthService, SessionService, TokensService, JwtModule],
})
export class AuthModule {}
