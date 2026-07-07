import Image from "next/image";
import { Radio, ShieldCheck, WifiOff } from "lucide-react";

const features = [
  { icon: WifiOff, label: "Offline-safe" },
  { icon: Radio, label: "Real-time" },
  { icon: ShieldCheck, label: "Audit-ready" },
];

/**
 * Full-height cinematic brand panel shared by the admin and judge login
 * screens. A full-bleed photographic hero behind a brand-tinted gradient
 * scrim, with the Eventify mark, an editorial headline and feature row
 * overlaid. Replaces the flat light-blue logo box.
 */
export function AuthBrandPanel() {
  return (
    <div className="relative hidden w-[55%] overflow-hidden lg:block">
      {/* Full-bleed photographic hero */}
      <Image
        src="/tabulation.jpg"
        alt=""
        fill
        priority
        sizes="55vw"
        className="object-cover"
      />

      {/* Brand-tinted scrims for depth + legibility */}
      <div className="absolute inset-0 bg-gradient-to-tr from-primary/85 via-slate-950/70 to-slate-950/30" />
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-transparent to-slate-950/10" />

      {/* Overlaid content */}
      <div className="relative flex h-full flex-col justify-between p-12 text-white">
        {/* Brand mark */}
        <span className="flex size-12 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20 backdrop-blur">
          <Image
            src="/logo.png"
            alt="Eventify"
            width={32}
            height={32}
            className="size-8"
          />
        </span>

        {/* System title */}
        <div className="max-w-lg space-y-6">
          <div className="space-y-3">
            <p className="font-display text-6xl font-semibold leading-none tracking-tight drop-shadow-sm xl:text-7xl">
              Eventify
            </p>
            <p className="text-sm font-medium uppercase tracking-[0.28em] text-white/70">
              Dynamic Events Tabulation System
            </p>
          </div>
          <p className="max-w-md text-base leading-relaxed text-white/75 text-pretty">
            Configurable judging, offline-safe scoring, and audit-ready results
            for every event you run.
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-3 pt-2">
            {features.map(({ icon: Icon, label }) => (
              <span
                key={label}
                className="inline-flex items-center gap-2 text-sm font-medium text-white/85"
              >
                <Icon className="size-4 text-white/60" />
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
