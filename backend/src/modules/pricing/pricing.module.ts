import { Global, Module } from '@nestjs/common';
import { FareEngineService } from './fare-engine.service';

@Global()
@Module({
  providers: [FareEngineService],
  exports: [FareEngineService],
})
export class PricingModule {}
