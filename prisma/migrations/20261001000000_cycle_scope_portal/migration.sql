-- Add 'Portal' to the cycle scope enum so cycles can target a whole portal
-- (e.g. "all of Mobile App") in addition to All / Module / Suite / Custom.
ALTER TYPE "CycleScopeType" ADD VALUE IF NOT EXISTS 'Portal';
