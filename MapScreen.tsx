import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Button,
  TouchableOpacity,
  ScrollView,
  Animated,
  Platform,
  Alert,
} from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import * as Location from "expo-location";
import * as Speech from "expo-speech";
import { point } from "@turf/helpers";
import pointToLineDistance from "@turf/point-to-line-distance";
import type { Feature, LineString } from "geojson";
import { collection, getDocs } from "firebase/firestore";
import { db } from "./scripts/firebaseConfig";

// 🎨 Color by speed
function getColorForSpeed(limit?: number) {
  if (!limit) return "#808080";
  if (limit <= 20) return "#FFFF00";
  if (limit <= 30) return "#FFA500";
  if (limit <= 40) return "#FF0000";
  return "#008000";
}

export default function MapScreen() {
  const [region, setRegion] = useState<any>(null);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [routeCoords, setRouteCoords] = useState<{ latitude: number; longitude: number; }[]>([]);
  const [legendVisible, setLegendVisible] = useState(true);
  const [searchVisible, setSearchVisible] = useState(true);
  const [userLoc, setUserLoc] = useState<Location.LocationObject | null>(null);
  const [userSpeed, setUserSpeed] = useState(0);
  const [currentRoad, setCurrentRoad] = useState<string | null>(null);
  const [speedLimit, setSpeedLimit] = useState<number>(0);
  const [roadFeatures, setRoadFeatures] = useState<Feature<LineString, any>[]>([]);
  const [loading, setLoading] = useState(true);

  const mapRef = useRef<MapView>(null);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const lastSpeech = useRef(0);

  // 🗺️ Fetch road data from Firestore
  useEffect(() => {
    const fetchRoads = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, "baguioRoads"));
        const roadsData = querySnapshot.docs.map(doc => doc.data());
        const formatted = roadsData.filter((r: any) => r.geometry && r.properties);
        setRoadFeatures(formatted as Feature<LineString, any>[]);
      } catch (err) {
        console.error("❌ Error fetching roads:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchRoads();
  }, []);

  // 🧭 Request location + start watching
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission denied", "Location permission is required.");
        return;
      }

      const pos = await Location.getCurrentPositionAsync({});
      setUserLoc(pos);
      setRegion({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        latitudeDelta: 0.03,
        longitudeDelta: 0.03,
      });

      Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 5 },
        (loc) => {
          setUserLoc(loc);
          const kmh = (loc.coords.speed ?? 0) * 3.6;
          setUserSpeed(kmh);

          const nearest = findNearestRoad(loc.coords.latitude, loc.coords.longitude);
          if (nearest && nearest.name !== currentRoad) {
            setCurrentRoad(nearest.name);
            setSpeedLimit(nearest.speed_limit || 40);
            Speech.speak(`Now entering ${nearest.name}. Speed limit is ${nearest.speed_limit || 40} km/h.`);
          }

          if (speedLimit && kmh > speedLimit + 3 && Date.now() - lastSpeech.current > 8000) {
            Speech.speak(`Warning! You are overspeeding. Limit is ${speedLimit} km/h.`);
            lastSpeech.current = Date.now();
          }
        }
      );
    })();
  }, [speedLimit]);

  // 🔍 Search bar logic
  const handleSearch = (text: string) => {
    setQuery(text);
    if (text.trim().length < 2) return setSuggestions([]);
    const matches = roadFeatures
      .map(r => r.properties?.name)
      .filter(n => n && n.toLowerCase().includes(text.toLowerCase()));
    setSuggestions(matches.slice(0, 5) as string[]);
  };

  // 🚗 When user selects a road
  const handleSelectRoad = async (roadName: string) => {
    setQuery(roadName);
    setSuggestions([]);
    setSearchVisible(false);

    if (!userLoc) {
      Alert.alert("Error", "User location not found.");
      return;
    }

    const feature = roadFeatures.find(f => f.properties?.name === roadName);
    if (!feature) return;

    const [lng, lat] = feature.geometry.coordinates[0] as [number, number];
    const dest = { latitude: lat, longitude: lng };

    const startLon = userLoc.coords.longitude;
    const startLat = userLoc.coords.latitude;
    const destLon = dest.longitude;
    const destLat = dest.latitude;

    try {
      const routeRes = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${startLon},${startLat};${destLon},${destLat}?overview=full&geometries=geojson`
      );
      const routeJson = await routeRes.json();
      const coords: [number, number][] = routeJson.routes[0].geometry.coordinates;
      const mapped = coords.map(([lon, lat]) => ({ latitude: lat, longitude: lon }));
      setRouteCoords(mapped);

      Speech.speak(`Navigating to ${roadName}. Follow the highlighted route.`);

      setRegion({
        latitude: dest.latitude,
        longitude: dest.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      });
    } catch (err) {
      Alert.alert("Error", "Failed to calculate route.");
    }
  };

  // 🧮 Find nearest road
  const findNearestRoad = (lat: number, lon: number) => {
    let nearest: any = null;
    let min = Infinity;
    for (const f of roadFeatures) {
      const d = pointToLineDistance(point([lon, lat]) as any, f as any, { units: "meters" });
      if (d < min) {
        min = d;
        nearest = f;
      }
    }
    if (nearest && min <= 20) {
      return {
        name: nearest.properties?.name ?? "Unknown road",
        speed_limit: nearest.properties?.speed_limit ?? 40,
      };
    }
    return null;
  };

  // 🧾 Animated collapse for legend
  const toggleLegend = () => {
    Animated.timing(slideAnim, {
      toValue: legendVisible ? 0 : 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
    setLegendVisible(!legendVisible);
  };

  const translateY = slideAnim.interpolate({ inputRange: [0, 1], outputRange: [160, 0] });

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <Text>Loading roads from Firestore...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {searchVisible && (
        <View style={styles.searchBox}>
          <TextInput
            style={styles.input}
            placeholder="Search road..."
            value={query}
            onChangeText={handleSearch}
          />
          <Button title="Go" onPress={() => handleSelectRoad(query)} />
          {suggestions.length > 0 && (
            <ScrollView style={styles.suggestions}>
              {suggestions.map((s, i) => (
                <TouchableOpacity key={i} onPress={() => handleSelectRoad(s)}>
                  <Text style={styles.suggestionText}>{s}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>
      )}

      <TouchableOpacity style={styles.toggleSearch} onPress={() => setSearchVisible(!searchVisible)}>
        <Text style={styles.toggleText}>{searchVisible ? "▲ Hide" : "▼ Search"}</Text>
      </TouchableOpacity>

      <MapView
        ref={mapRef}
        style={styles.map}
        showsUserLocation={!!userLoc}
        showsMyLocationButton={true}
        followsUserLocation={true}
        initialRegion={region ?? { latitude: 16.412, longitude: 120.599, latitudeDelta: 0.03, longitudeDelta: 0.03 }}
        region={region ?? undefined}
      >
        {roadFeatures.map((feature, i) => {
          const coords = feature.geometry.coordinates.map(coord => {
            const [lon, lat] = coord as [number, number];
            return { latitude: lat, longitude: lon };
          });
          return <Polyline key={i} coordinates={coords} strokeWidth={4} strokeColor={getColorForSpeed(feature.properties?.speed_limit)} />;
        })}

        {routeCoords.length > 0 && <Polyline coordinates={routeCoords} strokeWidth={6} strokeColor="#1E90FF" />}

        {userLoc && <Marker coordinate={{ latitude: userLoc.coords.latitude, longitude: userLoc.coords.longitude }} title="You" />}
      </MapView>

      <Animated.View style={[styles.legendContainer, { transform: [{ translateY }] }]}>
        <TouchableOpacity onPress={toggleLegend}>
          <Text style={styles.legendTitle}>{legendVisible ? "▼ Hide Legend" : "▲ Show Legend"}</Text>
        </TouchableOpacity>
        {legendVisible && (
          <ScrollView style={styles.legendList}>
            <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: "#FFFF00" }]} /><Text>20 km/h Roads</Text></View>
            <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: "#FFA500" }]} /><Text>30 km/h Roads</Text></View>
            <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: "#FF0000" }]} /><Text>40 km/h Roads</Text></View>
            <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: "#008000" }]} /><Text>50+ km/h Roads</Text></View>
          </ScrollView>
        )}
      </Animated.View>

      <View style={styles.statusBox}>
        <Text style={{ fontWeight: "bold" }}>Speed: {userSpeed.toFixed(1)} km/h</Text>
        <Text>Road: {currentRoad ?? "Unknown"} ({speedLimit || "--"} km/h)</Text>
      </View>
    </View>
  );
}

// 🎨 Styles
const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  searchBox: { position: "absolute", top: Platform.select({ ios: 50, android: 20 }), left: 10, right: 10, zIndex: 20, backgroundColor: "white", borderRadius: 10, padding: 8, elevation: 4 },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 6, marginBottom: 6 },
  suggestions: { backgroundColor: "#fff", borderRadius: 8, marginTop: 5, maxHeight: 120 },
  suggestionText: { padding: 8, borderBottomWidth: 0.5, borderBottomColor: "#ddd" },
  toggleSearch: { position: "absolute", top: 12, right: 12, backgroundColor: "white", borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4, zIndex: 25 },
  toggleText: { fontSize: 12, fontWeight: "bold" },
  legendContainer: { position: "absolute", bottom: 10, left: 10, right: 10, backgroundColor: "white", borderRadius: 10, padding: 10, elevation: 5 },
  legendTitle: { fontWeight: "bold", textAlign: "center", marginBottom: 6 },
  legendList: { maxHeight: 100 },
  legendItem: { flexDirection: "row", alignItems: "center", marginBottom: 5 },
  dot: { width: 18, height: 18, borderRadius: 9, marginRight: 8 },
  statusBox: { position: "absolute", top: Platform.select({ ios: 120, android: 80 }), right: 12, backgroundColor: "white", padding: 8, borderRadius: 8, elevation: 4 },
});
