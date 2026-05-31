import { View, Text } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

/* Jauge circulaire (arc partiel) — affiche une valeur sur /max au centre.
   Sans dépendance native autre que react-native-svg. */
export default function Gauge({
  value,
  max = 10,
  size = 84,
  thickness = 8,
  color = '#ED93B1',
  track = '#F4E6EC',
  textColor,
}) {
  const num = Number(value);
  const pct = Math.max(0, Math.min(1, (Number.isFinite(num) ? num : 0) / max));
  const r = (size - thickness) / 2;
  const circ = 2 * Math.PI * r;
  const dash = circ * pct;
  const center = size / 2;
  const display = Number.isFinite(num) ? num.toFixed(1).replace('.', ',') : '–';

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <Circle cx={center} cy={center} r={r} stroke={track} strokeWidth={thickness} fill="none" />
        <Circle
          cx={center}
          cy={center}
          r={r}
          stroke={color}
          strokeWidth={thickness}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          transform={`rotate(-90 ${center} ${center})`}
        />
      </Svg>
      <View style={{ position: 'absolute', alignItems: 'center' }}>
        <Text style={{ fontSize: size * 0.27, fontWeight: '800', color: textColor || color, lineHeight: size * 0.32 }}>
          {display}
        </Text>
        <Text style={{ fontSize: size * 0.13, color: '#9A9A9A', marginTop: 1 }}>/10</Text>
      </View>
    </View>
  );
}
