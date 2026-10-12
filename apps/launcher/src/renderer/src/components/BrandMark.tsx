import markUrl from '../assets/auram-mark-inverse.png';
import styles from './BrandMark.module.css';

/**
 * The official Auram mark (light-on-dark variant derived from the supplied logo;
 * see scripts/generate-brand-assets.py). Height is fixed, width follows the
 * original aspect ratio.
 */
export function BrandMark({
  height = 22,
  decorative = true,
}: {
  height?: number;
  decorative?: boolean;
}) {
  return (
    <img
      className={styles.mark}
      src={markUrl}
      height={height}
      style={{ height }}
      alt={decorative ? '' : 'Auram'}
      draggable={false}
    />
  );
}

export function Wordmark() {
  return (
    <span className={styles.wordmark}>
      <span className={styles.name}>Auram</span>
      <span className={styles.product}>Launcher</span>
    </span>
  );
}
