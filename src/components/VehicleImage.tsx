import { useState } from 'react';
import { CarFront } from 'lucide-react';

interface VehicleImageProps {
  src?: string | null;
  alt: string;
  className?: string;
}

export function VehicleImage({ src, alt, className = '' }: VehicleImageProps) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-slate-100 text-slate-400 ${className}`}
        role="img"
        aria-label={alt}
      >
        <CarFront className="w-8 h-8 mb-1.5 opacity-60" strokeWidth={1.5} />
        <span className="text-xs font-medium text-slate-500 px-3 text-center truncate max-w-full">
          {alt}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
