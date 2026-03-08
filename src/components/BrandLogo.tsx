'use client';

import Image from 'next/image';
import { useState } from 'react';
import styles from './BrandLogo.module.css';

const MARK_SRC = '/branding/mytrainingplan-logo-mark.png';
const WORDMARK_SRC = '/branding/mytrainingplan-logo-full.png';

type BrandLogoSize = 'header' | 'sidebar' | 'landing' | 'compact';
type BrandLogoVariant = 'app' | 'wordmark' | 'mark';

function sizeClass(size: BrandLogoSize) {
  switch (size) {
    case 'sidebar':
      return styles.sizeSidebar;
    case 'landing':
      return styles.sizeLanding;
    case 'compact':
      return styles.sizeCompact;
    case 'header':
    default:
      return styles.sizeHeader;
  }
}

export default function BrandLogo({
  variant = 'app',
  size = 'header',
  tone = 'default',
  compactOnMobile = false,
  className,
  priority = false
}: {
  variant?: BrandLogoVariant;
  size?: BrandLogoSize;
  tone?: 'default' | 'light';
  compactOnMobile?: boolean;
  className?: string;
  priority?: boolean;
}) {
  const [wordmarkMissing, setWordmarkMissing] = useState(false);
  const [markMissing, setMarkMissing] = useState(false);

  const shouldShowWordmark = variant === 'wordmark' && !wordmarkMissing;
  const shouldShowText = variant === 'app' || (variant === 'wordmark' && wordmarkMissing);

  return (
    <span
      className={[
        styles.root,
        sizeClass(size),
        tone === 'light' ? styles.toneLight : '',
        compactOnMobile ? styles.compactOnMobile : '',
        className || ''
      ].join(' ').trim()}
    >
      {shouldShowWordmark ? (
        <Image
          src={WORDMARK_SRC}
          alt="MyTrainingPlan"
          width={520}
          height={146}
          priority={priority}
          className={styles.wordmarkImage}
          onError={() => setWordmarkMissing(true)}
        />
      ) : (
        <>
          {(variant === 'mark' || variant === 'app' || (variant === 'wordmark' && wordmarkMissing)) && (
            <span className={styles.markBox}>
              {markMissing ? (
                <span className={styles.markFallback}>M</span>
              ) : (
                <Image
                  src={MARK_SRC}
                  alt=""
                  width={128}
                  height={128}
                  priority={priority}
                  className={styles.markImage}
                  onError={() => setMarkMissing(true)}
                />
              )}
            </span>
          )}
          {shouldShowText && (
            <span className={styles.text}>
              <span className={styles.textLead}>MyTraining</span>
              <span className={styles.textAccent}>Plan</span>
            </span>
          )}
        </>
      )}
    </span>
  );
}
