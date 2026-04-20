export default function Banner({ tone = 'info', icon, className = '', children }) {
    return (
        <div className={`banner banner--${tone} ${className}`}>
            {icon && <span>{icon}</span>}
            <span>{children}</span>
        </div>
    );
}
