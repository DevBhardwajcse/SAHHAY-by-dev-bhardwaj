'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  APIProvider,
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  Crosshair,
  Droplets,
  ExternalLink,
  Flag,
  List,
  Loader2,
  LocateFixed,
  Map as MapIcon,
  MapPin,
  Navigation,
  PhoneCall,
  Route as RouteIcon,
  Search,
  Share2,
  SlidersHorizontal,
  Stethoscope,
  WifiOff,
  X,
} from 'lucide-react';
import type { EmergencyCategoryId, NormalizedEmergencyPlace } from '@/app/api/maps/nearby/route';
import {
  buildLocationShareMessage,
  loadEmergencyContacts,
  type TrustedEmergencyContact,
} from '@/lib/emergency-contact';
import type { Language } from '@/lib/triage-engine';
import { usePWA } from './PWABootstrap';

interface EmergencyMapViewProps {
  language: Language;
  mapsApiKey: string;
  initialCategory?: string;
  initialSpecialtyQuery?: string;
  onOpenOffline: () => void;
}

const DEFAULT_CENTER = { lat: 28.6139, lng: 77.209 }; // New Delhi default fallback until user chooses

const CATEGORY_OPTIONS: Array<{
  id: EmergencyCategoryId;
  en: string;
  hi: string;
  pinColor: string;
}> = [
  { id: 'all', en: 'All Emergency', hi: 'सभी सेवाएं', pinColor: '#0F766E' },
  { id: 'emergency_hospital', en: 'Emergency Hospitals', hi: 'आपातकालीन अस्पताल', pinColor: '#DC2626' },
  { id: 'blood_bank', en: 'Blood Banks', hi: 'ब्लड बैंक', pinColor: '#BE123C' },
  { id: 'government_hospital', en: 'Govt. Hospitals', hi: 'सरकारी अस्पताल', pinColor: '#0F766E' },
  { id: 'general_hospital', en: 'General Hospitals', hi: 'सामान्य अस्पताल', pinColor: '#0284C7' },
  { id: 'phc', en: 'PHCs', hi: 'प्राथमिक स्वास्थ्य केंद्र', pinColor: '#0D9488' },
  { id: 'chc', en: 'CHCs', hi: 'सामुदायिक स्वास्थ्य केंद्र', pinColor: '#0D9488' },
  { id: 'medical_clinic', en: 'Medical Clinics', hi: 'मेडिकल क्लिनिक', pinColor: '#2563EB' },
  { id: 'doctor', en: 'Doctors', hi: 'डॉक्टर', pinColor: '#4F46E5' },
  { id: 'pharmacy', en: 'Pharmacies', hi: 'फ़ार्मेसी', pinColor: '#16A34A' },
  { id: 'ambulance', en: 'Ambulance', hi: 'एम्बुलेंस', pinColor: '#E11D48' },
  { id: 'police', en: 'Police Stations', hi: 'पुलिस स्टेशन', pinColor: '#1D4ED8' },
  { id: 'fire_station', en: 'Fire Stations', hi: 'अग्निशमन केंद्र', pinColor: '#EA580C' },
  { id: 'govt_emergency', en: 'Govt. Emergency', hi: 'सरकारी आपातकाल', pinColor: '#B91C1C' },
];

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;

const SPECIALTY_FILTERS: Array<{
  query: string;
  en: string;
  hi: string;
}> = [
  { query: '', en: 'All Specialties (Category Default)', hi: 'सभी विशेषज्ञताएं' },
  { query: 'emergency trauma hospital', en: 'Emergency & Trauma', hi: 'आपातकाल और ट्रॉमा' },
  { query: 'cardiology heart hospital', en: 'Cardiology / Heart', hi: 'हृदय रोग (कार्डियोलॉजी)' },
  { query: 'pediatric hospital child specialist', en: 'Pediatrics / Child', hi: 'बाल रोग (पीडियाट्रिक्स)' },
  { query: 'maternity hospital gynecologist', en: 'Maternity / OB-GYN', hi: 'प्रसूति / स्त्री रोग' },
  { query: 'orthopedic trauma hospital', en: 'Orthopedics / Bone', hi: 'हड्डी रोग (आर्थोपेडिक्स)' },
  { query: 'pulmonology chest specialist clinic', en: 'Respiratory / Chest', hi: 'श्वसन / चेस्ट रोग' },
  { query: 'psychiatry mental health clinic', en: 'Mental Health', hi: 'मानसिक स्वास्थ्य' },
  { query: 'eye hospital ophthalmologist', en: 'Eye / Ophthalmology', hi: 'नेत्र रोग (आंख)' },
  { query: 'general physician medical clinic', en: 'General Physician', hi: 'सामान्य चिकित्सक' },
];

const RADIUS_OPTIONS = [
  { meters: 2000, label: '2 km' },
  { meters: 5000, label: '5 km' },
  { meters: 10000, label: '10 km' },
  { meters: 25000, label: '25 km' },
  { meters: 50000, label: '50 km' },
];

function getPinColor(cat: EmergencyCategoryId): string {
  return CATEGORY_OPTIONS.find((c) => c.id === cat)?.pinColor || '#0F766E';
}

interface RouteOptionSummary {
  distanceText: string;
  durationText: string;
  isTrafficAware: boolean;
}

interface RouteMetrics {
  distanceText: string;
  durationText: string;
  isTrafficAware: boolean;
  alternatives: RouteOptionSummary[];
  path: Array<{ lat: number; lng: number }>;
}

/**
 * Computes an actual road route using the modern Google Maps JS Routes Library (`Route.computeRoutes()`)
 * and renders a polyline on the active GoogleMap instance.
 */
function RouteLayer({
  origin,
  destination,
  onMetrics,
}: {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number } | null;
  onMetrics: (metrics: RouteMetrics | null) => void;
}) {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const mapsLib = useMapsLibrary('maps');
  const polyRef = useRef<google.maps.Polyline | null>(null);

  const originLat = origin.lat;
  const originLng = origin.lng;
  const destLat = destination?.lat ?? null;
  const destLng = destination?.lng ?? null;

  useEffect(() => {
    if (polyRef.current) {
      polyRef.current.setMap(null);
      polyRef.current = null;
    }

    if (destLat === null || destLng === null || !map || !routesLib || !mapsLib) {
      onMetrics(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const RouteClass = (routesLib as unknown as {
          Route?: {
            computeRoutes: (req: unknown) => Promise<{
              routes?: Array<{
                distanceMeters?: number;
                durationMillis?: number;
                path?: Array<google.maps.LatLng>;
              }>;
            }>;
          };
        }).Route;

        if (!RouteClass?.computeRoutes) {
          onMetrics(null);
          return;
        }

        let response: {
          routes?: Array<{
            distanceMeters?: number;
            durationMillis?: number;
            path?: Array<google.maps.LatLng>;
          }>;
        } | null = null;
        let isTrafficAware = true;

        try {
          response = await RouteClass.computeRoutes({
            origin: { lat: originLat, lng: originLng },
            destination: { lat: destLat, lng: destLng },
            travelMode: 'DRIVING',
            routingPreference: 'TRAFFIC_AWARE',
            computeAlternativeRoutes: true,
            fields: ['path', 'distanceMeters', 'durationMillis'],
          });
        } catch {
          isTrafficAware = false;
          response = await RouteClass.computeRoutes({
            origin: { lat: originLat, lng: originLng },
            destination: { lat: destLat, lng: destLng },
            travelMode: 'DRIVING',
            fields: ['path', 'distanceMeters', 'durationMillis'],
          });
        }

        if (cancelled) return;
        const routes = response?.routes ?? [];
        const first = routes[0];
        if (!first) {
          onMetrics(null);
          return;
        }

        const km = first.distanceMeters ? (first.distanceMeters / 1000).toFixed(1) : null;
        const mins = first.durationMillis ? Math.max(1, Math.round(first.durationMillis / 60000)) : null;

        const pathPoints =
          first.path?.map((pt) => ({ lat: pt.lat(), lng: pt.lng() })) || [];

        if (pathPoints.length > 0 && mapsLib.Polyline) {
          const line = new mapsLib.Polyline({
            path: pathPoints,
            geodesic: true,
            strokeColor: '#0F766E',
            strokeOpacity: 0.92,
            strokeWeight: 4,
            map,
          });
          polyRef.current = line;
        }

        const alternatives: RouteOptionSummary[] = routes.slice(1, 3).map((alt) => ({
          distanceText: alt.distanceMeters
            ? `${(alt.distanceMeters / 1000).toFixed(1)} km`
            : 'Alt route',
          durationText: alt.durationMillis
            ? `~${Math.max(1, Math.round(alt.durationMillis / 60000))} min`
            : 'N/A',
          isTrafficAware,
        }));

        onMetrics({
          distanceText: km ? `${km} km road route` : 'Road route computed',
          durationText: mins
            ? isTrafficAware
              ? `~${mins} min (traffic-aware)`
              : `~${mins} min drive`
            : 'Live estimate unavailable',
          isTrafficAware,
          alternatives,
          path: pathPoints,
        });
      } catch {
        if (!cancelled) onMetrics(null);
      }
    })();

    return () => {
      cancelled = true;
      if (polyRef.current) {
        polyRef.current.setMap(null);
        polyRef.current = null;
      }
    };
  }, [originLat, originLng, destLat, destLng, map, routesLib, mapsLib, onMetrics]);

  return null;
}

/**
 * Keeps the GoogleMap viewport centered smoothly when the user updates their selected coordinates
 * or taps the Recenter button.
 */
function MapViewportSync({
  center,
  recenterSignal,
}: {
  center: { lat: number; lng: number };
  recenterSignal: number;
}) {
  const map = useMap();
  const centerLat = center.lat;
  const centerLng = center.lng;
  useEffect(() => {
    if (map) {
      map.panTo({ lat: centerLat, lng: centerLng });
    }
  }, [map, centerLat, centerLng, recenterSignal]);
  return null;
}

export function EmergencyMapView({
  language,
  mapsApiKey,
  initialCategory = 'emergency_hospital',
  initialSpecialtyQuery = '',
  onOpenOffline,
}: EmergencyMapViewProps) {
  const { isOnline, reportMapsQuotaExceeded } = usePWA();

  const validInitialCat = CATEGORY_OPTIONS.some((c) => c.id === initialCategory)
    ? (initialCategory as EmergencyCategoryId)
    : 'emergency_hospital';

  const [category, setCategory] = useState<EmergencyCategoryId>(validInitialCat);
  const [specialtyQuery, setSpecialtyQuery] = useState<string>(initialSpecialtyQuery);
  const [radiusMeters, setRadiusMeters] = useState<number>(5000);
  const [location, setLocation] = useState<{ lat: number; lng: number }>(DEFAULT_CENTER);
  const [locationLabel, setLocationLabel] = useState<string>(
    'New Delhi (Default — tap Detect Location or search your city/PIN)'
  );
  const [hasExplicitLocation, setHasExplicitLocation] = useState(false);
  const [recenterSignal, setRecenterSignal] = useState(0);

  const [manualQuery, setManualQuery] = useState('');
  const [locating, setLocating] = useState(false);
  const [searching, setSearching] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [places, setPlaces] = useState<NormalizedEmergencyPlace[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<NormalizedEmergencyPlace | null>(null);
  const [viewMode, setViewMode] = useState<'split' | 'map' | 'list'>('split');
  const [routeMetrics, setRouteMetrics] = useState<RouteMetrics | null>(null);
  const [showFullHours, setShowFullHours] = useState(false);

  // Smart Hospital Matcher filters & Blood Bank group helper
  const [sectorFilter, setSectorFilter] = useState<'all' | 'public_named' | 'other'>('all');
  const [sortMode, setSortMode] = useState<'best_match' | 'distance' | 'open_first'>('best_match');
  const [selectedBloodGroup, setSelectedBloodGroup] = useState<string>('O+');

  // Trusted Emergency Contacts (up to 3) & Share Location Modal
  const [trustedContacts, setTrustedContacts] = useState<TrustedEmergencyContact[]>([]);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  // Facility Information Report Modal
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportIssueType, setReportIssueType] = useState<
    'closed' | 'wrong_phone' | 'wrong_address' | 'wrong_hours' | 'wrong_specialty' | 'other'
  >('wrong_phone');
  const [reportDetails, setReportDetails] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportFeedback, setReportFeedback] = useState<string | null>(null);

  useEffect(() => {
    const contacts = loadEmergencyContacts();
    if (contacts.length > 0) {
      queueMicrotask(() => setTrustedContacts(contacts));
    }
  }, []);

  const [prevInitialCategory, setPrevInitialCategory] = useState(initialCategory);
  if (initialCategory !== prevInitialCategory) {
    setPrevInitialCategory(initialCategory);
    if (CATEGORY_OPTIONS.some((c) => c.id === initialCategory)) {
      setCategory(initialCategory as EmergencyCategoryId);
    }
  }

  const [prevInitialSpecialty, setPrevInitialSpecialty] = useState(initialSpecialtyQuery);
  if (initialSpecialtyQuery !== prevInitialSpecialty) {
    setPrevInitialSpecialty(initialSpecialtyQuery);
    setSpecialtyQuery(initialSpecialtyQuery);
  }

  const locLat = location.lat;
  const locLng = location.lng;

  // Trigger live nearby search whenever category, specialtyQuery, radius, or location changes
  useEffect(() => {
    if (!isOnline || !mapsApiKey) return;
    let cancelled = false;
    const controller = new AbortController();

    Promise.resolve()
      .then(() => {
        if (!cancelled) {
          setSearching(true);
          setMapError(null);
        }
        return fetch('/api/maps/nearby', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            lat: locLat,
            lng: locLng,
            radiusMeters,
            category,
            specialtyQuery: specialtyQuery.trim() || undefined,
          }),
        });
      })
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (res.status === 429 || data.quotaExceeded) {
          reportMapsQuotaExceeded();
          setMapError(data.error || 'Google Maps Platform demo quota reached.');
          setPlaces([]);
          return;
        }
        if (!res.ok) {
          setMapError(data.error || 'Could not retrieve nearby places.');
          setPlaces([]);
          return;
        }
        setPlaces(data.places || []);
        setSelectedPlace(null);
        setRouteMetrics(null);
        setShowFullHours(false);
      })
      .catch(() => {
        if (!cancelled && !controller.signal.aborted) {
          setMapError('Network error while searching nearby facilities. Check Safety Directory or call 112.');
        }
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [locLat, locLng, category, specialtyQuery, radiusMeters, isOnline, mapsApiKey, reportMapsQuotaExceeded]);

  // Explicit user-triggered geolocation (NEVER called automatically on mount)
  const handleDetectCurrentLocation = () => {
    setMapError(null);
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setMapError(
        language === 'hi'
          ? 'इस डिवाइस में GPS उपलब्ध नहीं है। कृपया नीचे अपना शहर, जिला या पिन कोड दर्ज करें।'
          : 'Browser geolocation is unavailable. Please enter your city, district, or PIN code below.'
      );
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const nextCoords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        setLocation(nextCoords);
        setHasExplicitLocation(true);
        setLocationLabel(
          `Current Location (${nextCoords.lat.toFixed(4)}, ${nextCoords.lng.toFixed(4)})`
        );
        // Reverse geocode for approximate human-readable address
        try {
          const revRes = await fetch('/api/maps/geocode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'reverse', lat: nextCoords.lat, lng: nextCoords.lng }),
          });
          if (revRes.status === 429) {
            reportMapsQuotaExceeded();
          } else if (revRes.ok) {
            const revData = await revRes.json();
            if (revData.formattedAddress) {
              setLocationLabel(revData.formattedAddress);
            }
          }
        } catch {
          // keep coordinate label
        } finally {
          setLocating(false);
        }
      },
      (err) => {
        setLocating(false);
        setMapError(
          err.code === err.PERMISSION_DENIED
            ? language === 'hi'
              ? 'लोकेशन अनुमति अस्वीकृत हुई। आप नीचे शहर, गांव या पिन कोड लिखकर खोज सकते हैं या मानचित्र पर क्लिक कर सकते हैं।'
              : 'Location permission was declined. Enter your city, village, district, or 6-digit PIN code below, or click anywhere on the map.'
            : 'Could not detect GPS location. Try entering your city or PIN code manually.'
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
    );
  };

  const handleManualGeocode = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = manualQuery.trim();
    if (q.length < 2) return;
    setLocating(true);
    setMapError(null);
    try {
      const res = await fetch('/api/maps/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'forward', query: q }),
      });
      const data = await res.json();
      if (res.status === 429 || data.quotaExceeded) {
        reportMapsQuotaExceeded();
        setMapError('Google Maps geocoding quota reached.');
        return;
      }
      if (!res.ok) {
        setMapError(data.error || 'Could not locate that place. Try a district name or PIN code.');
        return;
      }
      setLocation({ lat: data.lat, lng: data.lng });
      setHasExplicitLocation(true);
      setLocationLabel(data.formattedAddress || q);
    } catch {
      setMapError('Unable to geocode location right now.');
    } finally {
      setLocating(false);
    }
  };

  const handleRouteMetrics = useCallback((metrics: RouteMetrics | null) => {
    setRouteMetrics(metrics);
  }, []);

  const handleSubmitFacilityReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlace || reportSubmitting) return;
    setReportSubmitting(true);
    setReportFeedback(null);
    try {
      const res = await fetch('/api/maps/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          placeId: selectedPlace.id,
          facilityName: selectedPlace.name,
          facilityAddress: selectedPlace.address,
          issueType: reportIssueType,
          details: reportDetails,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setReportFeedback(data.error || 'Could not submit report.');
      } else {
        setReportFeedback(
          language === 'hi'
            ? 'धन्यवाद! आपकी रिपोर्ट समीक्षा के लिए दर्ज कर ली गई है।'
            : data.message || 'Thank you! Your report has been logged for review.'
        );
        setReportDetails('');
      }
    } catch {
      setReportFeedback('Network error while submitting report.');
    } finally {
      setReportSubmitting(false);
    }
  };

  const sharePayload = buildLocationShareMessage(
    location.lat,
    location.lng,
    locationLabel,
    language
  );

  const handleCopyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(sharePayload.message);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2500);
    } catch {
      setShareCopied(false);
    }
  };

  const nextExpandedRadius =
    RADIUS_OPTIONS.find((r) => r.meters > radiusMeters)?.meters || null;

  const displayedPlaces = useMemo(() => {
    const filtered = places.filter((p) => {
      if (sectorFilter === 'all') return true;
      const sector = p.ownershipSector || 'other';
      return sector === sectorFilter;
    });

    const sorted = [...filtered];
    if (sortMode === 'distance') {
      sorted.sort((a, b) => a.straightLineKm - b.straightLineKm);
    } else if (sortMode === 'open_first') {
      sorted.sort((a, b) => {
        const aOpen = a.openNowKnown === true ? 0 : a.openNowKnown === false ? 2 : 1;
        const bOpen = b.openNowKnown === true ? 0 : b.openNowKnown === false ? 2 : 1;
        if (aOpen !== bOpen) return aOpen - bOpen;
        return a.straightLineKm - b.straightLineKm;
      });
    } else {
      // Smart Hospital Matcher ranking: open status + emergency/specialty fit + proximity
      const score = (p: NormalizedEmergencyPlace) =>
        p.straightLineKm -
        (p.openNowKnown === true ? 2.5 : 0) -
        (p.category === 'emergency_hospital' || p.category === 'blood_bank' ? 1.5 : 0) -
        (p.phone ? 0.5 : 0);
      sorted.sort((a, b) => score(a) - score(b));
    }
    return sorted;
  }, [places, sectorFilter, sortMode]);

  return (
    <div className="min-w-0 max-w-full space-y-5 overflow-x-hidden">
      {/* Control Bar */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-xl font-extrabold text-slate-900">
              {language === 'hi'
                ? 'लाइव अस्पताल एवं आपातकालीन संसाधन मानचित्र'
                : 'Live Hospital & Emergency Resource Navigator'}
            </h1>
            <p className="mt-1 text-xs text-slate-600">
              {language === 'hi'
                ? 'लाइव Google Maps Platform द्वारा संचालित। अपनी लोकेशन चुनें, विशेषज्ञता के अनुसार सही अस्पताल खोजें और ट्रैफिक-आधारित मार्ग देखें।'
                : 'Live Google Maps Platform discovery with specialty matching, traffic-aware routing, and optional location sharing.'}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2 lg:flex-nowrap">
            <button
              type="button"
              disabled={locating}
              onClick={handleDetectCurrentLocation}
              className="inline-flex items-center gap-2 whitespace-nowrap rounded-xl bg-teal-700 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-teal-800 disabled:opacity-60"
            >
              {locating ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Crosshair className="h-4 w-4" aria-hidden="true" />
              )}
              <span>
                {language === 'hi' ? 'मेरी वर्तमान लोकेशन खोजें' : 'Detect My Current Location'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setShowShareModal(true)}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-800 hover:bg-slate-50"
            >
              <Share2 className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
              <span>{language === 'hi' ? 'लोकेशन साझा करें' : 'Share Location'}</span>
            </button>

            <a
              href="tel:112"
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-red-600 px-3.5 py-2.5 text-xs font-bold text-white hover:bg-red-700"
            >
              <PhoneCall className="h-3.5 w-3.5" aria-hidden="true" />
              <span>112</span>
            </a>
          </div>
        </div>

        {/* Manual City / PIN Search + Radius + View Switcher */}
        <div className="mt-4 grid gap-3 lg:grid-cols-12 lg:items-center">
          <form onSubmit={handleManualGeocode} className="flex items-center gap-2 lg:col-span-6">
            <div className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="text"
                value={manualQuery}
                onChange={(e) => setManualQuery(e.target.value)}
                aria-label="Enter city, village, district, or PIN code"
                placeholder={
                  language === 'hi'
                    ? 'शहर, गांव, जिला या 6-अंकीय पिन कोड दर्ज करें...'
                    : 'Enter city, village, district, or 6-digit PIN code...'
                }
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pr-3 pl-9 text-xs text-slate-900 focus:border-teal-600 focus:bg-white focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={locating || manualQuery.trim().length < 2}
              className="shrink-0 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              {language === 'hi' ? 'खोजें' : 'Set Area'}
            </button>
          </form>

          <div className="flex flex-wrap items-center justify-between gap-2 lg:col-span-6 lg:justify-end">
            <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
              {RADIUS_OPTIONS.map((r) => (
                <button
                  key={r.meters}
                  type="button"
                  onClick={() => setRadiusMeters(r.meters)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold tabular-nums transition ${
                    radiusMeters === r.meters
                      ? 'bg-teal-700 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
              {(
                [
                  { id: 'split', label: 'Split', icon: MapIcon },
                  { id: 'map', label: 'Map', icon: MapPin },
                  { id: 'list', label: 'List', icon: List },
                ] as const
              ).map((v) => {
                const Icon = v.icon;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setViewMode(v.id)}
                    className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold ${
                      viewMode === v.id
                        ? 'bg-white text-teal-800 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{v.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Active Search Location Strip */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-600">
          <div className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-teal-700" aria-hidden="true" />
            <span className="font-medium text-slate-800">{locationLabel}</span>
            {!hasExplicitLocation && (
              <span className="text-[11px] text-slate-500">(Click map to move pin)</span>
            )}
          </div>
          <span className="font-mono text-[11px] text-slate-500 tabular-nums">
            {displayedPlaces.length} {language === 'hi' ? 'संसाधन मिले' : 'facilities matched'}
          </span>
        </div>

        {/* Smart Hospital Matcher: Specialty + Sector + Match Ranking */}
        <div className="mt-3 flex flex-wrap items-center gap-2.5 border-t border-slate-100 pt-3">
          <div className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700">
            <Stethoscope className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
            <span>{language === 'hi' ? 'स्मार्ट अस्पताल मैचर:' : 'Smart Hospital Matcher:'}</span>
          </div>
          <select
            aria-label="Filter by medical specialty"
            value={
              SPECIALTY_FILTERS.some((s) => s.query === specialtyQuery)
                ? specialtyQuery
                : '__custom__'
            }
            onChange={(e) => {
              const val = e.target.value;
              if (val !== '__custom__') setSpecialtyQuery(val);
            }}
            className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:border-teal-600 focus:bg-white focus:outline-none"
          >
            {SPECIALTY_FILTERS.map((sf) => (
              <option key={sf.query || 'all'} value={sf.query}>
                {language === 'hi' ? sf.hi : sf.en}
              </option>
            ))}
            {specialtyQuery && !SPECIALTY_FILTERS.some((s) => s.query === specialtyQuery) && (
              <option value="__custom__">AI Recommended: {specialtyQuery}</option>
            )}
          </select>

          <select
            aria-label="Filter by hospital sector"
            value={sectorFilter}
            onChange={(e) =>
              setSectorFilter(e.target.value as 'all' | 'public_named' | 'other')
            }
            className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:border-teal-600 focus:bg-white focus:outline-none"
          >
            <option value="all">
              {language === 'hi' ? 'सभी सेक्टर (सरकारी + निजी)' : 'All Sectors (Public + Private)'}
            </option>
            <option value="public_named">
              {language === 'hi' ? 'सरकारी / सार्वजनिक नामित' : 'Public / Govt. Named Only'}
            </option>
            <option value="other">
              {language === 'hi' ? 'निजी / सामान्य सूचीबद्ध' : 'Private / General Listed'}
            </option>
          </select>

          <div className="inline-flex items-center gap-1.5">
            <SlidersHorizontal className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
            <select
              aria-label="Rank matched facilities"
              value={sortMode}
              onChange={(e) =>
                setSortMode(e.target.value as 'best_match' | 'distance' | 'open_first')
              }
              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:border-teal-600 focus:bg-white focus:outline-none"
            >
              <option value="best_match">
                {language === 'hi' ? 'क्रम: स्मार्ट क्लिनिकल मैच' : 'Rank: Best Clinical Match'}
              </option>
              <option value="distance">
                {language === 'hi' ? 'क्रम: सबसे नजदीक' : 'Rank: Closest Distance'}
              </option>
              <option value="open_first">
                {language === 'hi' ? 'क्रम: अभी खुला पहले' : 'Rank: Listed Open First'}
              </option>
            </select>
          </div>

          {(specialtyQuery || sectorFilter !== 'all') && (
            <button
              type="button"
              onClick={() => {
                setSpecialtyQuery('');
                setSectorFilter('all');
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-teal-200 bg-teal-50 px-2 py-1 text-[11px] font-semibold text-teal-800 hover:bg-teal-100"
            >
              <span>{language === 'hi' ? 'फ़िल्टर रीसेट' : 'Reset filters'}</span>
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* All 13 Emergency Resource Category Filter Buttons */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {CATEGORY_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => {
                setCategory(opt.id);
                setSpecialtyQuery('');
              }}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                category === opt.id && !specialtyQuery
                  ? opt.id === 'blood_bank'
                    ? 'bg-rose-700 text-white'
                    : 'bg-teal-700 text-white'
                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {language === 'hi' ? opt.hi : opt.en}
            </button>
          ))}
        </div>

        {/* Blood Bank Finder & Official e-RaktKosh Blood-Group Verification Card */}
        {category === 'blood_bank' && (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50/70 p-4 text-xs text-rose-950">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="max-w-2xl">
                <div className="flex items-center gap-1.5 font-bold text-rose-900">
                  <Droplets className="h-4 w-4 text-rose-700" aria-hidden="true" />
                  <span>
                    {language === 'hi'
                      ? 'ब्लड बैंक खोजक एवं आधिकारिक रक्त उपलब्धता जांच (e-RaktKosh)'
                      : 'Blood Bank Finder & Verified Blood-Group Availability (MoHFW e-RaktKosh)'}
                  </span>
                </div>
                <p className="mt-1 leading-relaxed text-rose-900/90">
                  {language === 'hi'
                    ? 'मानचित्र नीचे नजदीकी ब्लड बैंक और उनके फ़ोन नंबर दिखाता है। लाइव रक्त यूनिट स्टॉक की पुष्टि के लिए सीधे ब्लड बैंक को कॉल करें या भारत सरकार के आधिकारिक e-RaktKosh पोर्टल पर जांचें।'
                    : 'Live Google Maps locates nearby blood banks and phone numbers below. Because Google Maps does not carry live blood-unit inventory, call the blood bank directly or check verified real-time blood-group stock on the official Govt. of India MoHFW e-RaktKosh portal.'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href="https://eraktkosh.mohfw.gov.in/BLDAHIMS/bloodbank/stockAvailability.cnt"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-rose-700 px-3.5 py-2 text-xs font-bold text-white hover:bg-rose-800"
                >
                  <span>
                    {language === 'hi'
                      ? `e-RaktKosh (${selectedBloodGroup}) स्टॉक जांचें`
                      : `Check ${selectedBloodGroup} on e-RaktKosh`}
                  </span>
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
                <a
                  href="tel:104"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs font-bold text-rose-900 hover:bg-rose-50"
                >
                  <PhoneCall className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>104 Health Helpline</span>
                </a>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 font-semibold text-rose-900">
                {language === 'hi' ? 'ब्लड ग्रुप चुनें:' : 'Needed Blood Group:'}
              </span>
              {BLOOD_GROUPS.map((bg) => (
                <button
                  key={bg}
                  type="button"
                  onClick={() => setSelectedBloodGroup(bg)}
                  className={`rounded-md px-2.5 py-1 font-mono text-[11px] font-bold transition ${
                    selectedBloodGroup === bg
                      ? 'bg-rose-700 text-white'
                      : 'border border-rose-200 bg-white text-rose-900 hover:bg-rose-100'
                  }`}
                >
                  {bg}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Offline or Unconfigured Maps Guard */}
      {(!isOnline || !mapsApiKey) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-xs text-amber-950">
          <div className="flex items-start gap-2.5">
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
            <div>
              <div className="font-bold">
                {!isOnline
                  ? 'Live Google Maps is unavailable offline'
                  : 'Google Maps Platform API key is not active in this runtime'}
              </div>
              <p className="mt-0.5">
                Use the Offline Assistance Centre for independently sourced Government of India
                public hospitals, or dial 112 / 102 immediately for emergencies.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenOffline}
            className="rounded-xl bg-amber-800 px-4 py-2 text-xs font-bold text-white hover:bg-amber-900"
          >
            Open Offline Assistance Centre
          </button>
        </div>
      )}

      {mapError && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-950">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
            <span>{mapError}</span>
          </div>
          <button
            type="button"
            onClick={onOpenOffline}
            className="font-bold text-amber-900 underline"
          >
            Offline Hospitals
          </button>
        </div>
      )}

      {/* Synchronized Map + Results List */}
      <div className="grid min-w-0 gap-5 lg:grid-cols-12">
        {viewMode !== 'list' && mapsApiKey && isOnline && (
          <div
            className={`min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white ${
              viewMode === 'map' ? 'lg:col-span-12' : 'lg:col-span-7'
            }`}
          >
            <div className="relative h-[460px] w-full lg:h-[560px]">
              {/* Recenter on My Location floating control */}
              <button
                type="button"
                onClick={() => setRecenterSignal((n) => n + 1)}
                aria-label="Recenter map on my selected location"
                className="absolute right-3 bottom-6 z-10 inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-xs font-bold text-slate-800 shadow-sm backdrop-blur-xs hover:bg-slate-50"
              >
                <LocateFixed className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                <span>{language === 'hi' ? 'पुनः केंद्रित करें' : 'Recenter'}</span>
              </button>

              <APIProvider
                apiKey={mapsApiKey}
                language={language === 'hi' ? 'hi' : 'en'}
                region="IN"
              >
                <GoogleMap
                  defaultCenter={location}
                  defaultZoom={13}
                  mapId="DEMO_MAP_ID"
                  internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
                  gestureHandling="greedy"
                  onClick={(ev) => {
                    const latLng = ev.detail.latLng;
                    if (latLng) {
                      setLocation({ lat: latLng.lat, lng: latLng.lng });
                      setHasExplicitLocation(true);
                      setLocationLabel(
                        `Pinned Location (${latLng.lat.toFixed(4)}, ${latLng.lng.toFixed(4)})`
                      );
                    }
                  }}
                >
                  <MapViewportSync center={location} recenterSignal={recenterSignal} />

                  {/* User Search Origin Pin */}
                  <AdvancedMarker position={location} title="Search Origin">
                    <Pin background="#0F172A" borderColor="#FFFFFF" glyphColor="#FFFFFF" />
                  </AdvancedMarker>

                  {/* Nearby Emergency Resource Markers */}
                  {displayedPlaces.map((place) => (
                    <AdvancedMarker
                      key={place.id}
                      position={{ lat: place.lat, lng: place.lng }}
                      title={place.name}
                      onClick={() => setSelectedPlace(place)}
                    >
                      <Pin
                        background={getPinColor(place.category)}
                        borderColor="#FFFFFF"
                        glyphColor="#FFFFFF"
                      />
                    </AdvancedMarker>
                  ))}

                  {/* Synchronized InfoWindow */}
                  {selectedPlace && (
                    <InfoWindow
                      position={{ lat: selectedPlace.lat, lng: selectedPlace.lng }}
                      onCloseClick={() => {
                        setSelectedPlace(null);
                        setRouteMetrics(null);
                      }}
                    >
                      <div className="max-w-[230px] space-y-1 p-0.5 text-xs text-slate-900">
                        <div className="font-bold">{selectedPlace.name}</div>
                        <div className="text-[11px] text-teal-800">{selectedPlace.categoryLabel}</div>
                        <div className="text-[11px] text-slate-600">{selectedPlace.address}</div>
                        <div className="text-[11px] font-semibold text-slate-700 tabular-nums">
                          {routeMetrics
                            ? `${routeMetrics.distanceText} · ${routeMetrics.durationText}`
                            : `~${selectedPlace.straightLineKm} km (straight-line approx.)`}
                        </div>
                      </div>
                    </InfoWindow>
                  )}

                  {/* Routes API Polylines */}
                  <RouteLayer
                    origin={location}
                    destination={
                      selectedPlace ? { lat: selectedPlace.lat, lng: selectedPlace.lng } : null
                    }
                    onMetrics={handleRouteMetrics}
                  />
                </GoogleMap>
              </APIProvider>
            </div>
          </div>
        )}

        {/* List + Selected Resource Detail Drawer */}
        {viewMode !== 'map' && (
          <div
            className={`min-w-0 space-y-4 ${
              viewMode === 'list' || !mapsApiKey || !isOnline ? 'lg:col-span-12' : 'lg:col-span-5'
            }`}
          >
            {/* Selected Place Detail Panel */}
            {selectedPlace && (
              <div className="rounded-2xl border border-teal-200 bg-teal-50/40 p-4 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[11px] font-bold text-teal-800 uppercase">
                      {selectedPlace.categoryLabel}
                    </div>
                    <h2 className="mt-0.5 text-sm font-extrabold text-slate-900">
                      {selectedPlace.name}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPlace(null);
                      setRouteMetrics(null);
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600"
                  >
                    Close
                  </button>
                </div>

                <p className="mt-1.5 text-slate-700">{selectedPlace.address}</p>

                <div className="mt-2.5 space-y-1.5 rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-800 tabular-nums">
                    <RouteIcon className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                    <span>
                      {routeMetrics
                        ? `${routeMetrics.distanceText} (${routeMetrics.durationText})`
                        : `Approx. ${selectedPlace.straightLineKm} km straight-line distance`}
                    </span>
                  </div>
                  {routeMetrics && routeMetrics.alternatives.length > 0 && (
                    <div className="text-[11px] text-slate-600 tabular-nums">
                      <strong>Alternative routes:</strong>{' '}
                      {routeMetrics.alternatives
                        .map((a) => `${a.distanceText} (${a.durationText})`)
                        .join(' · ')}
                    </div>
                  )}
                  {selectedPlace.businessStatus && (
                    <div className="text-[11px] text-slate-600">
                      <strong>Status:</strong>{' '}
                      <span className="font-mono text-[10px] uppercase">
                        {selectedPlace.businessStatus.replace(/_/g, ' ')}
                      </span>
                    </div>
                  )}
                  <div className="text-[11px] text-slate-600">
                    <strong>Ownership:</strong> {selectedPlace.ownershipLabel}
                  </div>
                  <div className="text-[11px] text-slate-600">
                    <strong>Hours:</strong>{' '}
                    {selectedPlace.openNowKnown === true
                      ? 'Listed as currently open on Google Maps (confirm by calling)'
                      : selectedPlace.openNowKnown === false
                        ? 'Listed as closed on Google Maps (confirm emergency desk by calling)'
                        : 'Operating hours not confirmed — verify directly with facility'}
                  </div>
                  {selectedPlace.openingHoursFull && selectedPlace.openingHoursFull.length > 0 && (
                    <div>
                      <button
                        type="button"
                        onClick={() => setShowFullHours((prev) => !prev)}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-800 hover:underline"
                      >
                        <Clock className="h-3 w-3" aria-hidden="true" />
                        <span>{showFullHours ? 'Hide weekly hours' : 'View weekly hours'}</span>
                      </button>
                      {showFullHours && (
                        <ul className="mt-1 space-y-0.5 pl-4 text-[11px] text-slate-600">
                          {selectedPlace.openingHoursFull.map((line, i) => (
                            <li key={i}>{line}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  <div className="text-[11px] text-slate-500">
                    Real-time bed availability and specialist presence are not guaranteed by map data.
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedPlace.phone && (
                    <a
                      href={`tel:${selectedPlace.phone.replace(/[^0-9+]/g, '')}`}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-teal-700 px-3.5 py-2 font-bold text-white hover:bg-teal-800"
                    >
                      <PhoneCall className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className="tabular-nums">{selectedPlace.phone}</span>
                    </a>
                  )}
                  <a
                    href={
                      selectedPlace.googleMapsUri ||
                      `https://www.google.com/maps/dir/?api=1&destination=${selectedPlace.lat},${selectedPlace.lng}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 font-bold text-slate-800 hover:bg-slate-50"
                  >
                    <Navigation className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                    <span>Open Directions</span>
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      setReportFeedback(null);
                      setShowReportModal(true);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    <Flag className="h-3.5 w-3.5 text-amber-700" aria-hidden="true" />
                    <span>{language === 'hi' ? 'गलत जानकारी रिपोर्ट करें' : 'Report Issue'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Results List */}
            <div className="rounded-2xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <span className="text-xs font-bold text-slate-900">
                  {language === 'hi' ? 'नजदीकी सुविधाएं' : 'Nearby Facilities'}
                </span>
                {searching && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-teal-700">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    Searching...
                  </span>
                )}
              </div>

              <div className="max-h-[480px] divide-y divide-slate-100 overflow-y-auto">
                {displayedPlaces.length === 0 && !searching ? (
                  <div className="p-6 text-center text-xs text-slate-600">
                    <p>
                      {sectorFilter !== 'all' && places.length > 0
                        ? language === 'hi'
                          ? 'चुने गए सेक्टर फ़िल्टर से कोई सुविधा मेल नहीं खाई। सभी सेक्टर दिखाने के लिए फ़िल्टर रीसेट करें।'
                          : 'No facilities match the selected Public/Private sector filter. Show all sectors to view nearby results.'
                        : language === 'hi'
                          ? `चुने गए ${radiusMeters / 1000} किमी दायरे में कोई परिणाम नहीं मिला।`
                          : `No facilities returned within ${radiusMeters / 1000} km for this category.`}
                    </p>
                    {sectorFilter !== 'all' && places.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setSectorFilter('all')}
                        className="mt-3 rounded-xl bg-teal-700 px-4 py-2 text-xs font-bold text-white hover:bg-teal-800"
                      >
                        Show All Sectors ({places.length})
                      </button>
                    ) : (
                      nextExpandedRadius && (
                        <button
                          type="button"
                          onClick={() => setRadiusMeters(nextExpandedRadius)}
                          className="mt-3 rounded-xl bg-teal-700 px-4 py-2 text-xs font-bold text-white hover:bg-teal-800"
                        >
                          Expand Search Radius to {nextExpandedRadius / 1000} km
                        </button>
                      )
                    )}
                  </div>
                ) : (
                  displayedPlaces.map((place) => {
                    const isSelected = selectedPlace?.id === place.id;
                    return (
                      <button
                        key={place.id}
                        type="button"
                        onClick={() => setSelectedPlace(place)}
                        className={`flex w-full items-start justify-between gap-3 px-4 py-3.5 text-left transition ${
                          isSelected ? 'bg-teal-50/70' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-xs font-bold text-slate-900">
                            {place.name}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-teal-800">
                            <span>{place.categoryLabel}</span>
                            {place.openNowKnown === true && (
                              <span className="font-semibold text-emerald-700">· Listed Open</span>
                            )}
                          </div>
                          <div className="mt-0.5 line-clamp-1 text-[11px] text-slate-500">
                            {place.address}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="font-mono text-xs font-bold text-slate-900 tabular-nums">
                            ~{place.straightLineKm} km
                          </div>
                          <div className="text-[10px] text-slate-500">straight-line</div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Share My Location Modal (User-Confirmed Only) */}
      {showShareModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Share current location"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-extrabold text-slate-900">
                  {language === 'hi' ? 'मेरी लोकेशन साझा करें' : 'Share My Location'}
                </h2>
                <p className="mt-0.5 text-xs text-slate-600">
                  {language === 'hi'
                    ? 'आपकी पुष्टि के बिना कोई संदेश स्वतः नहीं भेजा जाता।'
                    : 'Nothing is ever sent automatically — choose how to share your Google Maps pin.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowShareModal(false)}
                aria-label="Close share location modal"
                className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {trustedContacts.length > 0 ? (
              <div className="mt-3 space-y-2">
                {trustedContacts.map((contact, idx) => (
                  <div
                    key={contact.id || idx}
                    className="rounded-xl border border-teal-200 bg-teal-50/70 p-3 text-xs"
                  >
                    <div className="font-bold text-teal-900">
                      {contact.name}
                      {contact.relationship ? ` (${contact.relationship})` : ''}
                    </div>
                    <div className="mt-0.5 font-mono text-teal-800">{contact.phone}</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <a
                        href={`sms:${contact.phone.replace(/[^0-9+]/g, '')}?body=${encodeURIComponent(
                          sharePayload.message
                        )}`}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 font-bold text-white hover:bg-teal-800"
                      >
                        <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{language === 'hi' ? 'SMS द्वारा भेजें' : 'Send via SMS'}</span>
                      </a>
                      <a
                        href={`tel:${contact.phone.replace(/[^0-9+]/g, '')}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-teal-700 bg-white px-3 py-1.5 font-bold text-teal-800 hover:bg-teal-50"
                      >
                        <PhoneCall className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{language === 'hi' ? 'कॉल करें' : 'Call'}</span>
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                {language === 'hi'
                  ? 'त्वरित SMS साझाकरण के लिए आप Profile & Privacy में अधिकतम 3 विश्वसनीय आपातकालीन संपर्क सहेज सकते हैं।'
                  : 'Tip: Save up to 3 Trusted Emergency Contacts in Profile & Privacy for one-tap SOS & SMS location sharing.'}
              </div>
            )}

            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              <div className="font-semibold text-slate-900">{locationLabel}</div>
              <div className="mt-1 break-all font-mono text-[11px] text-teal-800">
                {sharePayload.mapsUrl}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleCopyShareLink()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800"
              >
                {shareCopied ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                ) : (
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span>
                  {shareCopied
                    ? language === 'hi'
                      ? 'कॉपी हो गया!'
                      : 'Copied!'
                    : language === 'hi'
                      ? 'लोकेशन संदेश कॉपी करें'
                      : 'Copy Location Message'}
                </span>
              </button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(sharePayload.message)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50"
              >
                <ExternalLink className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                <span>WhatsApp</span>
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Facility Information Report Modal */}
      {showReportModal && selectedPlace && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Report incorrect facility information"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <form
            onSubmit={handleSubmitFacilityReport}
            className="w-full max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-extrabold text-slate-900">
                  {language === 'hi'
                    ? 'अस्पताल/सुविधा जानकारी सुधार रिपोर्ट'
                    : 'Report Incorrect Facility Information'}
                </h2>
                <p className="mt-0.5 text-xs font-medium text-teal-800">{selectedPlace.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowReportModal(false)}
                aria-label="Close report modal"
                className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div>
              <label htmlFor="report-issue-type" className="block text-xs font-semibold text-slate-700">
                {language === 'hi' ? 'समस्या का प्रकार' : 'Issue Type'}
              </label>
              <select
                id="report-issue-type"
                value={reportIssueType}
                onChange={(e) =>
                  setReportIssueType(
                    e.target.value as
                      | 'closed'
                      | 'wrong_phone'
                      | 'wrong_address'
                      | 'wrong_hours'
                      | 'wrong_specialty'
                      | 'other'
                  )
                }
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900"
              >
                <option value="wrong_phone">Incorrect phone number</option>
                <option value="closed">Facility permanently or temporarily closed</option>
                <option value="wrong_address">Wrong address or map pin location</option>
                <option value="wrong_hours">Incorrect operating / emergency hours</option>
                <option value="wrong_specialty">Medical specialty not available here</option>
                <option value="other">Other correction</option>
              </select>
            </div>

            <div>
              <label htmlFor="report-details" className="block text-xs font-semibold text-slate-700">
                {language === 'hi' ? 'संक्षिप्त विवरण' : 'Brief Details'}
              </label>
              <textarea
                id="report-details"
                rows={3}
                required
                minLength={3}
                maxLength={500}
                value={reportDetails}
                onChange={(e) => setReportDetails(e.target.value)}
                placeholder={
                  language === 'hi'
                    ? 'कृपया बताएं कि क्या जानकारी गलत है...'
                    : 'Describe what needs correction (e.g. phone disconnected, moved location)...'
                }
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-teal-600 focus:bg-white focus:outline-none"
              />
            </div>

            {reportFeedback && (
              <div className="rounded-xl border border-teal-200 bg-teal-50 p-2.5 text-xs font-semibold text-teal-900">
                {reportFeedback}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowReportModal(false)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                {language === 'hi' ? 'बंद करें' : 'Close'}
              </button>
              <button
                type="submit"
                disabled={reportSubmitting || reportDetails.trim().length < 3}
                className="rounded-xl bg-teal-700 px-4 py-2 text-xs font-bold text-white hover:bg-teal-800 disabled:opacity-50"
              >
                {reportSubmitting
                  ? 'Submitting...'
                  : language === 'hi'
                    ? 'रिपोर्ट भेजें'
                    : 'Submit Report'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
