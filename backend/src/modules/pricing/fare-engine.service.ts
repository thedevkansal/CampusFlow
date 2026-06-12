import { Injectable } from '@nestjs/common';
import { AppConfigService } from '@common/config/app-config.service';

export interface FareEstimate {
  distanceKm: number;
  estimatedFare: number;
}

@Injectable()
export class FareEngineService {
  constructor(private readonly config: AppConfigService) {}

  /** Haversine great-circle distance in km. */
  distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /** Calculate fare for a given distance. */
  fareForDistance(distKm: number): number {
    return parseFloat(
      (this.config.fareBaseFare + distKm * this.config.farePerKmRate).toFixed(2),
    );
  }

  /** One-shot helper: distance + fare from coordinates. */
  estimate(lat1: number, lng1: number, lat2: number, lng2: number): FareEstimate {
    const distKm = this.distanceKm(lat1, lng1, lat2, lng2);
    return { distanceKm: distKm, estimatedFare: this.fareForDistance(distKm) };
  }
}
