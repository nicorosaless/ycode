/** rin5 badge shown on published pages when enabled in site settings. */
export default function YcodeBadge() {
  return (
    <a
      href="https://rin5.app"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Esta web se ha creado con rin5."
      style={{
        background: '#050606',
        borderRadius: '8px',
        bottom: '10px',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        fontSize: '12px',
        fontWeight: 700,
        padding: '12px 14px',
        position: 'fixed',
        right: '10px',
        textDecoration: 'none',
        zIndex: 9999,
      }}
    >
      Hecho con rin5<span style={{ color: '#10b981' }}>.</span>
    </a>
  );
}
