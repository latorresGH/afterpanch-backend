import { Module } from '@nestjs/common';
import { ShippingController } from './shipping.controller';
import { ShippingService } from './shipping.service';
import { GeocodingService } from './geocoding.service';
import { NominatimGeocodingProvider } from './providers/nominatim.provider';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ShippingController],
  providers: [
    ShippingService,
    GeocodingService,
    {
      provide: 'GEOCODING_PROVIDER',
      useClass: NominatimGeocodingProvider,
    },
  ],
  exports: [ShippingService, GeocodingService],
})
export class ShippingModule {}
