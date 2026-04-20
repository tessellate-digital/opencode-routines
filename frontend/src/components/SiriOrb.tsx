import classNames from 'classnames';
import './SiriOrb.style.css';

const SIZE_THRESHOLD_SMALL = 50;
const SIZE_THRESHOLD_TINY = 30;
const SIZE_THRESHOLD_MEDIUM = 100;

interface SiriOrbProps {
  size?: string;
  className?: string;
  animationDuration?: number;
}

export function SiriOrb({ size = '42px', className = '', animationDuration = 20 }: SiriOrbProps) {
  const colors = {
    bg: 'oklch(95% 0.02 264.695)',
    c1: 'oklch(75% 0.15 350)',
    c2: 'oklch(80% 0.12 200)',
    c3: 'oklch(78% 0.14 280)',
  };

  const sizeValue = parseInt(size.replace('px', ''), 10);

  const blurAmount =
    sizeValue < SIZE_THRESHOLD_SMALL
      ? Math.max(sizeValue * 0.008, 1)
      : Math.max(sizeValue * 0.015, 4);

  const contrastBase =
    sizeValue < SIZE_THRESHOLD_SMALL
      ? Math.max(sizeValue * 0.004, 1.2)
      : Math.max(sizeValue * 0.008, 1.5);

  const dotSize =
    sizeValue < SIZE_THRESHOLD_SMALL
      ? Math.max(sizeValue * 0.004, 0.05)
      : Math.max(sizeValue * 0.008, 0.1);

  const shadowSpread =
    sizeValue < SIZE_THRESHOLD_SMALL
      ? Math.max(sizeValue * 0.004, 0.5)
      : Math.max(sizeValue * 0.008, 2);

  const maskRadius =
    sizeValue < SIZE_THRESHOLD_TINY
      ? '0%'
      : sizeValue < SIZE_THRESHOLD_SMALL
        ? '5%'
        : sizeValue < SIZE_THRESHOLD_MEDIUM
          ? '15%'
          : '25%';

  const finalContrast =
    sizeValue < SIZE_THRESHOLD_TINY
      ? 1.1
      : sizeValue < SIZE_THRESHOLD_SMALL
        ? Math.max(contrastBase * 1.2, 1.3)
        : contrastBase;

  return (
    <div
      className={classNames('siri-orb', className)}
      style={
        {
          width: size,
          height: size,
          '--orb-bg': colors.bg,
          '--orb-c1': colors.c1,
          '--orb-c2': colors.c2,
          '--orb-c3': colors.c3,
          '--orb-duration': `${animationDuration}s`,
          '--orb-blur': `${blurAmount}px`,
          '--orb-contrast': finalContrast,
          '--orb-dot': `${dotSize}px`,
          '--orb-shadow': `${shadowSpread}px`,
          '--orb-mask-r': maskRadius,
        } as React.CSSProperties
      }
    />
  );
}
