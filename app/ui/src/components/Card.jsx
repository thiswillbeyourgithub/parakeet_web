export default function Card({ tone, className = '', children, style }) {
    const cls = ['card', tone ? `card--${tone}` : '', className].filter(Boolean).join(' ');
    return (
        <div className={cls} style={style}>
            {children}
        </div>
    );
}
