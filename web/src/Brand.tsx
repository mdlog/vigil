/** The Vigil V mark and wordmark, shared by the landing page and the dashboard sidebar. */
export function Brand({ href, compact = false }: { href: string; compact?: boolean }) {
  return (
    <a className="brand" href={href} aria-label="Vigil home">
      <img className="brand-mark" src={`${import.meta.env.BASE_URL}vigil-mark.png`} alt="" width={26} height={26} />
      <span className={compact ? 'brand-name brand-name--compact' : 'brand-name'}>VIGIL</span>
    </a>
  );
}
