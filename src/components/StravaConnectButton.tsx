import StravaIcon from '@/components/StravaIcon';

type StravaConnectButtonProps = {
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  reconnect?: boolean;
  className?: string;
};

export default function StravaConnectButton({
  onClick,
  disabled = false,
  reconnect = false,
  className = ''
}: StravaConnectButtonProps) {
  const label = reconnect ? 'Reconnect with Strava' : 'Connect with Strava';
  const classes = ['strava-connect-btn', className].filter(Boolean).join(' ');

  return (
    <button
      className={classes}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
    >
      <StravaIcon size={14} className="strava-connect-btn-icon" />
      <span>{label}</span>
    </button>
  );
}
