import { classNames } from '@aeolus-fleet/ui';

/**
 * The Aeolus logo from brand/ (the files are copies in public/brand): the
 * wordmark, or the mark alone where there is no room. Slate on light, light
 * slate on dark.
 */
export function BrandLogo({ kind, className }: { kind: 'wordmark' | 'mark'; className?: string }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- the console optimizes no image (next.config.ts) */}
      <img src={`/brand/aeolus-${kind}-slate.svg`} alt="Aeolus" className={classNames('dark:hidden', className)} />
      {/* eslint-disable-next-line @next/next/no-img-element -- same as above */}
      <img src={`/brand/aeolus-${kind}-light-slate.svg`} alt="Aeolus" className={classNames('hidden dark:block', className)} />
    </>
  );
}
