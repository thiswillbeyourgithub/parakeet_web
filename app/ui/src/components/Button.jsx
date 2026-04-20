export default function Button({ variant = 'primary', className = '', children, ...props }) {
    return (
        <button className={`btn btn--${variant} ${className}`} {...props}>
            {children}
        </button>
    );
}
