'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Markdown from 'react-markdown';
import {
  AlertTriangle,
  ArrowRight,
  BookmarkPlus,
  BookOpen,
  Brain,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  FileSearch,
  FileText,
  Flag,
  Loader2,
  MapPin,
  MessageSquareHeart,
  Mic,
  MicOff,
  PhoneCall,
  Pill,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Square,
  Stethoscope,
  Upload,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { CareRecommendation } from '@/lib/clinical-knowledge-base';
import { INITIAL_GREETING, UI_STRINGS } from '@/lib/i18n';
import type { EmergencyCheckResult, Language } from '@/lib/triage-engine';
import { useAuth } from './AuthProvider';
import { usePWA } from './PWABootstrap';
import type { AssistantSubMode } from './HomeDashboard';
import { LabReportAnalyzer } from './LabReportAnalyzer';
import { PrescriptionReader } from './PrescriptionReader';
import { MedicineSafetyChecker } from './MedicineSafetyChecker';

interface ClinicalRefCard {
  source: string;
  verified: boolean;
  title: string;
  documentTitle?: string;
  category?: string;
  commonUses: string;
  precautions: string;
  url?: string;
  publicationDate?: string;
  version?: string;
  reviewStatus?: string;
  lastVerifiedDate?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  emergency?: EmergencyCheckResult;
  references?: ClinicalRefCard[];
  groundingSources?: Array<{ title: string; uri: string }>;
  recommendedCare?: CareRecommendation;
  followUpSuggestions?: string[];
}

interface MedicineResult {
  emergency?: EmergencyCheckResult;
  unidentified: boolean;
  isUncertain?: boolean;
  safetyReason?: string;
  safetyNotice?: string;
  extraction?: {
    isLoosePillOnly: boolean;
    packagingLegibility: string;
    productName: string;
    activeIngredients: string[];
    strength: string;
    dosageForm: string;
    manufacturer: string;
    expiryDate: string;
    packagingWarnings: string[];
    category: string;
    generalUses: string;
    whyPrescribed: string;
    doctorPharmacistGuidance: string;
    missingOrUnclearDetails: string;
  };
  clinicalReferences?: ClinicalRefCard[];
  mandatorySafetyReminders?: string[];
}

interface InjuryResult {
  emergency?: EmergencyCheckResult;
  stoppedForEmergency?: boolean;
  recommendHospitalVisit?: boolean;
  result?: {
    imageQuality: string;
    visibleObservations: string[];
    cannotDetermineFromImage: string[];
    limitationsExplanation: string;
    followUpQuestions: string[];
    generalNextSteps: string[];
    whenToSeeDoctor: string[];
    whenEmergencyNeeded: string[];
    recommendHospitalVisit: boolean;
  };
}

interface MedicalAssistantProps {
  language: Language;
  initialMode?: AssistantSubMode;
  onFindHospital: (category?: string, specialtyQuery?: string) => void;
  onOpenOffline: () => void;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read audio'));
    reader.readAsDataURL(blob);
  });
}

export function MedicalAssistant({
  language,
  initialMode = 'chat',
  onFindHospital,
  onOpenOffline,
}: MedicalAssistantProps) {
  const t = UI_STRINGS[language];
  const { isOnline } = usePWA();
  const { user, profile, saveSessionWithConsent } = useAuth();

  const [mode, setMode] = useState<AssistantSubMode>(initialMode);
  const [prevInitialMode, setPrevInitialMode] = useState<AssistantSubMode>(initialMode);
  if (initialMode !== prevInitialMode) {
    setPrevInitialMode(initialMode);
    setMode(initialMode);
  }
  const msgSeqRef = useRef(0);

  // --- Chat State ---
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [deepThinking, setDeepThinking] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [expandedRefKeys, setExpandedRefKeys] = useState<Record<string, boolean>>({});
  const [doctorSummary, setDoctorSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryCopied, setSummaryCopied] = useState(false);
  const [safetySeedMedicines, setSafetySeedMedicines] = useState<string[]>([]);
  const [flaggingMsg, setFlaggingMsg] = useState<ChatMessage | null>(null);
  const [flagReason, setFlagReason] = useState('');
  const [flagBusy, setFlagBusy] = useState(false);
  const [flagDone, setFlagDone] = useState<string | null>(null);

  // --- Medicine Scanner State ---
  const [medPreview, setMedPreview] = useState<string | null>(null);
  const [medMime, setMedMime] = useState<string>('image/jpeg');
  const [medNote, setMedNote] = useState('');
  const [medLoading, setMedLoading] = useState(false);
  const [medError, setMedError] = useState<string | null>(null);
  const [medResult, setMedResult] = useState<MedicineResult | null>(null);

  // --- Injury Analyzer State ---
  const [injPreview, setInjPreview] = useState<string | null>(null);
  const [injMime, setInjMime] = useState<string>('image/jpeg');
  const [injDesc, setInjDesc] = useState('');
  const [injLoading, setInjLoading] = useState(false);
  const [injError, setInjError] = useState<string | null>(null);
  const [injResult, setInjResult] = useState<InjuryResult | null>(null);

  // --- Voice Assistant State ---
  const [voiceLang, setVoiceLang] = useState<'auto' | 'en' | 'hi'>('auto');
  const [isRecording, setIsRecording] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [lastSpokenText, setLastSpokenText] = useState<string>('');
  const [lastSpokenLang, setLastSpokenLang] = useState<Language>(language);
  const [voiceTurns, setVoiceTurns] = useState<
    Array<{ role: 'user' | 'model'; text: string; lang: Language; emergency?: EmergencyCheckResult }>
  >([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  // --- Clinical Reference Lookup State ---
  const [refQuery, setRefQuery] = useState('');
  const [refKind, setRefKind] = useState<'medicine' | 'topic'>('medicine');
  const [refLoading, setRefLoading] = useState(false);
  const [refError, setRefError] = useState<string | null>(null);
  const [refResults, setRefResults] = useState<ClinicalRefCard[]>([]);
  const [refSources, setRefSources] = useState<string[]>([]);

  const medicalHistoryPayload =
    profile?.consentMedicalHistory
      ? {
          ageGroup: profile.ageGroup || undefined,
          allergies: profile.allergiesSummary || undefined,
          chronicConditions: profile.conditionsSummary || undefined,
          currentMedications: profile.medicationsSummary || undefined,
        }
      : undefined;

  const stopAudioPlayback = () => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current.currentTime = 0;
      audioPlayerRef.current = null;
    }
    setIsSpeaking(false);
  };

  useEffect(() => {
    return () => {
      stopAudioPlayback();
    };
  }, []);

  // --- Handlers: Medical Chat ---
  const sendChatMessage = async (overrideText?: string) => {
    const text = (overrideText ?? chatInput).trim();
    if (!text || chatLoading) return;
    setChatError(null);
    setSaveFeedback(null);

    msgSeqRef.current += 1;
    const userMsg: ChatMessage = {
      id: `u-${msgSeqRef.current}`,
      role: 'user',
      text,
    };
    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setChatInput('');
    setChatLoading(true);

    try {
      const res = await fetch('/api/medical/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          language,
          deepThinking,
          useSearchGrounding: true,
          history: messages.slice(-8).map((m) => ({ role: m.role, text: m.text })),
          medicalHistoryContext: medicalHistoryPayload,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setChatError(data.error || 'Could not reach SAHAAY AI right now.');
      } else {
        msgSeqRef.current += 1;
        setMessages((prev) => [
          ...prev,
          {
            id: `m-${msgSeqRef.current}`,
            role: 'model',
            text: data.reply,
            emergency: data.emergency,
            references: data.references,
            groundingSources: data.groundingSources,
            recommendedCare: data.recommendedCare,
            followUpSuggestions: data.followUpSuggestions,
          },
        ]);
      }
    } catch {
      setChatError(
        language === 'hi'
          ? 'नेटवर्क त्रुटि। कृपया सुरक्षा निर्देशिका या 112 हेल्पलाइन का उपयोग करें।'
          : 'Network error. Please use the Safety Directory or Verified 112 Helplines if urgent.'
      );
    } finally {
      setChatLoading(false);
    }
  };

  const handleGenerateDoctorSummary = async () => {
    if (messages.length === 0 || summaryLoading) return;
    setSummaryLoading(true);
    setSummaryCopied(false);
    try {
      const res = await fetch('/api/medical/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language,
          messages: messages.slice(-20).map((m) => ({
            role: m.role,
            text: m.text.slice(0, 4000),
          })),
        }),
      });
      const data = await res.json();
      if (res.ok && data.summary) {
        setDoctorSummary(data.summary);
      } else {
        setChatError(data.error || 'Could not generate doctor summary.');
      }
    } catch {
      setChatError('Unable to generate doctor summary right now.');
    } finally {
      setSummaryLoading(false);
    }
  };

  const handleDownloadDoctorSummary = () => {
    if (!doctorSummary) return;
    const blob = new Blob([doctorSummary], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sahaay-doctor-summary.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveCurrentSession = async (
    sessionType: 'general_chat' | 'medicine_scan' | 'injury_analysis' | 'voice_session',
    title: string,
    summary: string,
    urgency: 'routine' | 'soon' | 'urgent' | 'emergency' = 'routine',
    consentedTranscript?: string
  ) => {
    if (!user) {
      setSaveFeedback(
        language === 'hi'
          ? 'सत्र सारांश सहेजने के लिए कृपया Profile & Privacy में Google से साइन इन करें।'
          : 'Sign in with Google under Profile & Privacy to save consented summaries.'
      );
      return;
    }
    try {
      await saveSessionWithConsent({
        sessionType,
        language,
        title,
        summary,
        urgencyLevel: urgency,
        consentedTranscript,
      });
      setSaveFeedback(
        language === 'hi'
          ? 'आपकी स्पष्ट सहमति से सारांश "Saved Sessions" में सहेजा गया।'
          : 'Summary saved to Saved Sessions with your explicit consent.'
      );
    } catch {
      setSaveFeedback(
        language === 'hi' ? 'सारांश सहेजने में त्रुटि हुई।' : 'Could not save summary right now.'
      );
    }
  };

  // --- Handlers: Medicine Scan ---
  const handleMedicineFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMedError(null);
    setMedResult(null);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setMedError('Please upload a JPEG, PNG, or WebP photograph of medicine packaging.');
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      setMedError('Image exceeds 6 MB. Please select a smaller photograph.');
      return;
    }
    const b64 = await fileToBase64(file);
    setMedMime(file.type);
    setMedPreview(b64);
  };

  const runMedicineAnalysis = async () => {
    if (!medPreview || medLoading) return;
    setMedLoading(true);
    setMedError(null);
    setMedResult(null);
    setSaveFeedback(null);
    try {
      const res = await fetch('/api/medical/medicine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: medPreview,
          mimeType: medMime,
          userNote: medNote,
          language,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMedError(data.error || 'Medicine image analysis could not be completed.');
      } else {
        setMedResult(data);
      }
    } catch {
      setMedError('Unable to reach server for medicine image analysis. Please retry.');
    } finally {
      setMedLoading(false);
    }
  };

  // --- Handlers: Injury Analyzer ---
  const handleInjuryFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setInjError(null);
    setInjResult(null);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setInjError('Please upload a JPEG, PNG, or WebP photograph.');
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      setInjError('Image exceeds 6 MB. Please select a smaller photograph.');
      return;
    }
    const b64 = await fileToBase64(file);
    setInjMime(file.type);
    setInjPreview(b64);
  };

  const runInjuryAnalysis = async () => {
    if (!injPreview || injLoading) return;
    setInjLoading(true);
    setInjError(null);
    setInjResult(null);
    setSaveFeedback(null);
    try {
      const res = await fetch('/api/medical/injury', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: injPreview,
          mimeType: injMime,
          description: injDesc,
          language,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInjError(data.error || 'Injury observation could not be completed.');
      } else {
        setInjResult(data);
      }
    } catch {
      setInjError('Unable to reach server right now. If urgent, call 112 or visit a hospital.');
    } finally {
      setInjLoading(false);
    }
  };

  // --- Handlers: Bilingual Voice ---
  const playTtsAudio = async (text: string, lang: Language) => {
    if (voiceMuted || !text.trim()) return;
    stopAudioPlayback();
    try {
      const res = await fetch('/api/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, language: lang }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.audioBase64) return;
      const audio = new Audio(`data:${data.mimeType || 'audio/wav'};base64,${data.audioBase64}`);
      audioPlayerRef.current = audio;
      setIsSpeaking(true);
      audio.onended = () => setIsSpeaking(false);
      audio.onerror = () => setIsSpeaking(false);
      await audio.play();
    } catch {
      setIsSpeaking(false);
    }
  };

  const startVoiceRecording = async () => {
    setVoiceError(null);
    stopAudioPlayback();
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setVoiceError(
        language === 'hi'
          ? 'इस ब्राउज़र में माइक्रोफ़ोन रिकॉर्डिंग उपलब्ध नहीं है। कृपया टेक्स्ट चैट का उपयोग करें।'
          : 'Microphone recording is not supported in this browser. Please switch to Text Chat.'
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        void processVoiceBlob(blob, mimeType);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch {
      setVoiceError(
        language === 'hi'
          ? 'माइक्रोफ़ोन अनुमति अस्वीकृत हुई। आप ब्राउज़र सेटिंग में अनुमति दे सकते हैं या टेक्स्ट चैट में स्विच कर सकते हैं।'
          : 'Microphone permission was denied or unavailable. You can grant microphone access or switch to Text Chat below.'
      );
    }
  };

  const stopVoiceRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const processVoiceBlob = async (blob: Blob, mimeType: string) => {
    setVoiceBusy(true);
    setVoiceError(null);
    try {
      const audioBase64 = await blobToBase64(blob);
      const transRes = await fetch('/api/voice/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioBase64,
          mimeType,
          preferredLanguage: voiceLang,
        }),
      });
      const transData = await transRes.json();
      if (!transRes.ok || !transData.transcript) {
        setVoiceError(
          transData.error ||
            (language === 'hi'
              ? 'स्पष्ट आवाज़ सुनाई नहीं दी। कृपया शांत वातावरण में दोबारा बोलें।'
              : 'Could not hear clear speech. Please try speaking again or use Text Chat.')
        );
        return;
      }

      const detectedLang: Language =
        voiceLang === 'auto'
          ? transData.detectedLanguage === 'hi'
            ? 'hi'
            : 'en'
          : voiceLang;

      setVoiceTurns((prev) => [
        ...prev,
        { role: 'user', text: transData.transcript, lang: detectedLang },
      ]);

      const chatRes = await fetch('/api/medical/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: transData.transcript,
          language: detectedLang,
          isVoice: true,
          useSearchGrounding: true,
          history: voiceTurns.slice(-6).map((v) => ({ role: v.role, text: v.text })),
          medicalHistoryContext: medicalHistoryPayload,
        }),
      });
      const chatData = await chatRes.json();
      if (!chatRes.ok) {
        setVoiceError(chatData.error || 'Could not generate response.');
        return;
      }

      setVoiceTurns((prev) => [
        ...prev,
        {
          role: 'model',
          text: chatData.reply,
          lang: detectedLang,
          emergency: chatData.emergency,
        },
      ]);
      setLastSpokenText(chatData.reply);
      setLastSpokenLang(detectedLang);
      if (!voiceMuted) {
        await playTtsAudio(chatData.reply, detectedLang);
      }
    } catch {
      setVoiceError('Voice processing failed. Please retry or switch to Text Chat.');
    } finally {
      setVoiceBusy(false);
    }
  };

  // --- Handlers: Clinical Reference Lookup ---
  const runReferenceSearch = async (overrideQ?: string, overrideKind?: 'medicine' | 'topic') => {
    const q = (overrideQ ?? refQuery).trim();
    const k = overrideKind ?? refKind;
    if (q.length < 2) return;
    setRefQuery(q);
    setRefKind(k);
    setRefLoading(true);
    setRefError(null);
    try {
      const res = await fetch(
        `/api/medical/reference?q=${encodeURIComponent(q)}&kind=${encodeURIComponent(k)}`
      );
      const data = await res.json();
      if (!res.ok) {
        setRefError(data.error || 'Reference lookup failed.');
      } else {
        setRefResults(data.results || []);
        setRefSources(data.sourcesQueried || []);
      }
    } catch {
      setRefError('Could not query clinical references right now.');
    } finally {
      setRefLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header & Mode Switcher */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-extrabold text-slate-900">
              {language === 'hi' ? 'SAHAAY AI चिकित्सा सहायक' : 'SAHAAY AI Medical Assistant'}
            </h1>
            <p className="mt-0.5 text-xs text-slate-600">
              {language === 'hi'
                ? 'सामान्य स्वास्थ्य जानकारी, दवा पैकेजिंग स्कैन, दृश्य चोट अवलोकन और द्विभाषी आवाज़ सहायता — डॉक्टर का विकल्प नहीं।'
                : 'General health education, medicine packaging scan, limited injury observations & bilingual voice — informational only.'}
            </p>
          </div>
          <a
            href="tel:112"
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-red-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-red-700"
          >
            <PhoneCall className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{t.emergency112}</span>
          </a>
        </div>

        {/* Clean Segmented Sub-Mode Tabs */}
        <div
          role="tablist"
          aria-label="Medical assistant modes"
          className="mt-4 flex flex-wrap gap-1.5 border-t border-slate-100 pt-4"
        >
          {(
            [
              {
                id: 'chat',
                icon: MessageSquareHeart,
                en: 'Medical Chat',
                hi: 'स्वास्थ्य चैट',
              },
              { id: 'lab_report', icon: FileSearch, en: 'Lab Report', hi: 'लैब रिपोर्ट' },
              { id: 'prescription', icon: FileText, en: 'Prescription', hi: 'प्रिस्क्रिप्शन' },
              { id: 'safety_check', icon: ShieldCheck, en: 'Safety Checker', hi: 'दवा सुरक्षा' },
              { id: 'medicine', icon: Pill, en: 'Medicine Scan', hi: 'दवा स्कैन' },
              { id: 'injury', icon: Camera, en: 'Injury Photo', hi: 'चोट अवलोकन' },
              { id: 'voice', icon: Mic, en: 'Voice', hi: 'वॉइस' },
              {
                id: 'reference',
                icon: BookOpen,
                en: 'References',
                hi: 'चिकित्सा संदर्भ',
              },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const active = mode === item.id;
            return (
              <button
                key={item.id}
                role="tab"
                aria-selected={active}
                type="button"
                onClick={() => setMode(item.id)}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition ${
                  active
                    ? 'bg-teal-700 text-white shadow-xs'
                    : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{language === 'hi' ? item.hi : item.en}</span>
              </button>
            );
          })}
        </div>
      </div>

      {!isOnline && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-950">
          <span>
            {language === 'hi'
              ? 'आप वर्तमान में ऑफ़लाइन हैं। लाइव AI उत्तर के लिए इंटरनेट आवश्यक है — आप ऑफ़लाइन सहायता केंद्र और 112 हेल्पलाइन का उपयोग कर सकते हैं।'
              : 'You are currently offline. Live Gemini AI features require connectivity — Offline Assistance Centre and 112 Helplines work offline.'}
          </span>
          <button
            type="button"
            onClick={onOpenOffline}
            className="rounded-lg bg-amber-800 px-3 py-1.5 font-bold text-white hover:bg-amber-900"
          >
            {language === 'hi' ? 'ऑफ़लाइन केंद्र खोलें' : 'Open Offline Centre'}
          </button>
        </div>
      )}

      {saveFeedback && (
        <div
          role="status"
          className="flex items-center justify-between rounded-xl border border-teal-200 bg-teal-50 px-4 py-2.5 text-xs font-semibold text-teal-900"
        >
          <span>{saveFeedback}</span>
          <button type="button" onClick={() => setSaveFeedback(null)} aria-label="Dismiss notice">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ==================== TAB 1: MEDICAL CHAT ==================== */}
      {mode === 'chat' && (
        <div className="rounded-2xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={deepThinking}
                onChange={(e) => setDeepThinking(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-teal-700"
              />
              <Brain className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
              <span>
                {language === 'hi'
                  ? 'गहन चिकित्सा विश्लेषण (Deep Reasoning)'
                  : 'Deep Medical Reasoning'}
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-2">
              {messages.length > 0 && (
                <>
                  <button
                    type="button"
                    disabled={summaryLoading}
                    onClick={() => void handleGenerateDoctorSummary()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {summaryLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-teal-700" aria-hidden="true" />
                    ) : (
                      <FileText className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                    )}
                    <span>
                      {language === 'hi' ? 'डॉक्टर सारांश बनाएं' : 'Generate Doctor Summary'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const summaryText = messages
                        .map((m) => `${m.role === 'user' ? 'User' : 'SAHAAY'}: ${m.text}`)
                        .join('\n\n')
                        .slice(0, 3800);
                      const hasEmergency = messages.some((m) => m.emergency?.isEmergency);
                      void handleSaveCurrentSession(
                        'general_chat',
                        messages[0].text.slice(0, 90),
                        summaryText,
                        hasEmergency ? 'emergency' : 'routine'
                      );
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-100"
                  >
                    <BookmarkPlus className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{t.saveSessionBtn}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMessages([]);
                      setDoctorSummary(null);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{language === 'hi' ? 'साफ़ करें' : 'Clear'}</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Conversation Stream */}
          <div className="max-h-[540px] space-y-4 overflow-y-auto p-5">
            {/* Exact Mandatory SAHAAY Welcome Message */}
            <div className="rounded-2xl border border-teal-100 bg-teal-50/60 p-4 text-sm leading-relaxed text-slate-800">
              <div className="mb-1 text-xs font-bold text-teal-800">SAHAAY AI Health Assistant</div>
              <p>{INITIAL_GREETING[language]}</p>

              {/* Quick starter prompts */}
              {messages.length === 0 && (
                <div className="mt-3.5 flex flex-wrap gap-2">
                  {(language === 'hi'
                    ? [
                        'हल्के बुखार और सिरदर्द में डॉक्टर से कब मिलना चाहिए?',
                        'निर्जलीकरण (डिहाइड्रेशन) के शुरुआती लक्षण क्या हैं?',
                        'दवा के लेबल पर एक्सपायरी और सामग्री कैसे जांचें?',
                      ]
                    : [
                        'When should a doctor evaluate a persistent fever?',
                        'What are early warning signs of dehydration?',
                        'How should I check medicine packaging safely?',
                      ]
                  ).map((sample) => (
                    <button
                      key={sample}
                      type="button"
                      onClick={() => void sendChatMessage(sample)}
                      className="rounded-lg border border-teal-200 bg-white px-3 py-1.5 text-left text-xs font-medium text-teal-900 hover:bg-teal-50"
                    >
                      {sample}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {messages.map((msg) => (
              <div
                key={msg.id}
                className={msg.role === 'user' ? 'flex justify-end' : 'space-y-3'}
              >
                {msg.role === 'user' ? (
                  <div className="max-w-2xl rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white">
                    {msg.text}
                  </div>
                ) : (
                  <div
                    className={`rounded-2xl border p-4 text-sm ${
                      msg.emergency?.isEmergency
                        ? 'border-red-300 bg-red-50 text-red-950'
                        : 'border-slate-200 bg-white text-slate-800'
                    }`}
                  >
                    {msg.emergency?.isEmergency && (
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-red-600 px-4 py-3 text-white">
                        <div className="flex items-center gap-2 text-xs font-extrabold">
                          <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
                          <span>
                            {language === 'hi' ? msg.emergency.headlineHi : msg.emergency.headlineEn}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <a
                            href="tel:112"
                            className="rounded-lg bg-white px-3 py-1.5 text-xs font-extrabold text-red-700 hover:bg-red-50"
                          >
                            Call 112
                          </a>
                          <button
                            type="button"
                            onClick={() => onFindHospital('emergency_hospital')}
                            className="rounded-lg border border-white/50 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700"
                          >
                            {t.findHospital}
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="markdown-clinical text-sm">
                      <Markdown>{msg.text}</Markdown>
                    </div>

                    {/* Inline "Find Nearby Medical Assistance" Action Card (ONLY when care is recommended) */}
                    {msg.recommendedCare?.shouldRecommend && !msg.emergency?.isEmergency && (
                      <div className="mt-4 flex flex-col gap-3 rounded-xl border border-teal-200 bg-teal-50/70 p-3.5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-start gap-2.5">
                          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-700 text-white">
                            <Stethoscope className="h-4 w-4" aria-hidden="true" />
                          </div>
                          <div className="text-xs">
                            <div className="font-bold text-teal-950">
                              {language === 'hi'
                                ? `सुझाई गई देखभाल: ${msg.recommendedCare.labelHi}`
                                : `Appropriate Care Match: ${msg.recommendedCare.labelEn}`}
                            </div>
                            <p className="mt-0.5 text-slate-700">
                              {language === 'hi'
                                ? msg.recommendedCare.reasonHi
                                : msg.recommendedCare.reasonEn}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            onFindHospital(
                              msg.recommendedCare!.facilityCategory,
                              msg.recommendedCare!.specialtyQuery
                            )
                          }
                          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-teal-700 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-teal-800"
                        >
                          <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>
                            {language === 'hi'
                              ? 'नजदीकी चिकित्सा सहायता खोजें'
                              : 'Find Nearby Medical Assistance'}
                          </span>
                        </button>
                      </div>
                    )}

                    {/* Expandable Clinician-Reviewed Reference Cards with Full Provenance Metadata */}
                    {msg.references && msg.references.length > 0 && (
                      <div className="mt-4 border-t border-slate-100 pt-3">
                        <div className="text-[11px] font-bold tracking-wide text-teal-800 uppercase">
                          {language === 'hi'
                            ? 'सत्यापित चिकित्सा संदर्भ (MoHFW / WHO / OpenFDA / MedlinePlus)'
                            : 'Clinician-Reviewed References (MoHFW / WHO / OpenFDA / MedlinePlus)'}
                        </div>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          {msg.references.map((ref, idx) => {
                            const refKey = `${msg.id}-${idx}`;
                            const isExpanded = Boolean(expandedRefKeys[refKey]);
                            return (
                              <div
                                key={refKey}
                                className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="font-bold text-slate-900">
                                    {ref.documentTitle || ref.title}
                                  </div>
                                  <button
                                    type="button"
                                    aria-expanded={isExpanded}
                                    onClick={() =>
                                      setExpandedRefKeys((prev) => ({
                                        ...prev,
                                        [refKey]: !prev[refKey],
                                      }))
                                    }
                                    className="shrink-0 rounded-md p-0.5 text-slate-500 hover:bg-slate-200/70"
                                    aria-label={isExpanded ? 'Collapse reference details' : 'Expand reference details'}
                                  >
                                    {isExpanded ? (
                                      <ChevronUp className="h-3.5 w-3.5" />
                                    ) : (
                                      <ChevronDown className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                </div>
                                <div className="mt-0.5 text-[11px] font-medium text-teal-800">
                                  {ref.source}
                                </div>
                                {(ref.version || ref.lastVerifiedDate) && (
                                  <div className="mt-1 font-mono text-[10px] text-slate-500">
                                    {ref.reviewStatus || 'Reviewed'}
                                    {ref.version ? ` · ${ref.version}` : ''}
                                    {ref.lastVerifiedDate ? ` · Verified ${ref.lastVerifiedDate}` : ''}
                                  </div>
                                )}
                                <p
                                  className={`mt-1.5 text-slate-600 ${
                                    isExpanded ? '' : 'line-clamp-2'
                                  }`}
                                >
                                  {ref.commonUses}
                                </p>
                                {isExpanded && (
                                  <div className="mt-2 space-y-1 border-t border-slate-200 pt-2 text-[11px] text-slate-600">
                                    <div>
                                      <strong className="text-slate-800">Precautions:</strong>{' '}
                                      {ref.precautions}
                                    </div>
                                    {ref.publicationDate && (
                                      <div>
                                        <strong className="text-slate-800">Published:</strong>{' '}
                                        {ref.publicationDate}
                                      </div>
                                    )}
                                    {ref.url && (
                                      <a
                                        href={ref.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 font-semibold text-teal-800 hover:underline"
                                      >
                                        <span>Open Reference Source</span>
                                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                                      </a>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Google Search Grounding Sources */}
                    {msg.groundingSources && msg.groundingSources.length > 0 && (
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2.5 text-[11px] text-slate-500">
                        <span className="font-semibold text-slate-700">Sources:</span>
                        {msg.groundingSources.map((src, i) => (
                          <a
                            key={i}
                            href={src.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-teal-800 hover:underline"
                          >
                            <span className="max-w-[180px] truncate">{src.title}</span>
                            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                          </a>
                        ))}
                      </div>
                    )}

                    {/* Medical Answer Verification Bar: Inspect Sources + Report Potentially Incorrect Answer */}
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5 text-[11px]">
                      <Link
                        href="/verification"
                        className="inline-flex items-center gap-1 font-semibold text-teal-800 hover:underline"
                      >
                        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>
                          {language === 'hi'
                            ? 'स्रोत एवं सत्यापन तिथियां देखें'
                            : 'Verify Clinical Sources & Evidence'}
                        </span>
                      </Link>
                      <button
                        type="button"
                        onClick={() => {
                          setFlaggingMsg(msg);
                          setFlagReason('');
                          setFlagDone(null);
                        }}
                        className="inline-flex items-center gap-1 font-semibold text-slate-500 hover:text-amber-700"
                      >
                        <Flag className="h-3 w-3" aria-hidden="true" />
                        <span>
                          {language === 'hi' ? 'गलत उत्तर रिपोर्ट करें' : 'Report Potentially Incorrect Answer'}
                        </span>
                      </button>
                    </div>

                    {/* Context-Aware Follow-Up Suggestions (shown under latest assistant reply) */}
                    {msg.followUpSuggestions &&
                      msg.followUpSuggestions.length > 0 &&
                      messages[messages.length - 1]?.id === msg.id && (
                        <div className="mt-3.5 border-t border-slate-100 pt-3">
                          <div className="mb-1.5 text-[11px] font-semibold text-slate-500">
                            {language === 'hi' ? 'संबंधित अगले प्रश्न:' : 'Suggested follow-up questions:'}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {msg.followUpSuggestions.map((sugg) => (
                              <button
                                key={sugg}
                                type="button"
                                disabled={chatLoading}
                                onClick={() => void sendChatMessage(sugg)}
                                className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-left text-xs font-medium text-slate-800 transition hover:border-teal-600 hover:bg-teal-50 hover:text-teal-900 disabled:opacity-50"
                              >
                                {sugg}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                  </div>
                )}
              </div>
            ))}

            {chatLoading && (
              <div className="flex items-center gap-2 text-xs font-semibold text-teal-800">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>
                  {language === 'hi'
                    ? 'सत्यापित चिकित्सा संदर्भों के साथ उत्तर तैयार किया जा रहा है...'
                    : 'Consulting clinician-reviewed references and preparing structured guidance...'}
                </span>
              </div>
            )}

            {chatError && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                {chatError}
              </div>
            )}
          </div>

          {/* Input Composer with Quick Multimodal Shortcuts */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendChatMessage();
            }}
            className="border-t border-slate-200 p-4"
          >
            <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-500">
                {language === 'hi' ? 'त्वरित उपकरण:' : 'Quick tools:'}
              </span>
              <button
                type="button"
                onClick={() => setMode('medicine')}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:border-teal-600 hover:text-teal-800"
              >
                <Pill className="h-3 w-3" aria-hidden="true" />
                <span>{language === 'hi' ? 'दवा स्कैन' : 'Medicine Scan'}</span>
              </button>
              <button
                type="button"
                onClick={() => setMode('injury')}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:border-teal-600 hover:text-teal-800"
              >
                <Camera className="h-3 w-3" aria-hidden="true" />
                <span>{language === 'hi' ? 'चोट तस्वीर' : 'Injury Photo'}</span>
              </button>
              <button
                type="button"
                onClick={() => setMode('voice')}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:border-teal-600 hover:text-teal-800"
              >
                <Mic className="h-3 w-3" aria-hidden="true" />
                <span>{language === 'hi' ? 'बोलकर पूछें' : 'Voice Chat'}</span>
              </button>
            </div>
            <div className="flex items-end gap-2">
              <textarea
                rows={2}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void sendChatMessage();
                  }
                }}
                aria-label={language === 'hi' ? 'अपना स्वास्थ्य प्रश्न लिखें' : 'Ask a general health question'}
                placeholder={
                  language === 'hi'
                    ? 'अपना सामान्य स्वास्थ्य प्रश्न हिन्दी या अंग्रेज़ी में लिखें...'
                    : 'Type a general health question in English or Hindi...'
                }
                className="flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:bg-white focus:outline-none"
              />
              <button
                type="submit"
                disabled={chatLoading || !chatInput.trim()}
                className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-teal-700 px-4 text-xs font-bold text-white transition hover:bg-teal-800 disabled:opacity-50"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
                <span>{language === 'hi' ? 'भेजें' : 'Send'}</span>
              </button>
            </div>
          </form>

          {/* Doctor Consultation Summary Modal */}
          {doctorSummary && (
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Doctor consultation summary"
              className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
            >
              <div className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[11px] font-bold tracking-wide text-teal-800 uppercase">
                      {language === 'hi'
                        ? 'डॉक्टर से मिलने हेतु संरचित सारांश'
                        : 'Structured Doctor Consultation Summary'}
                    </div>
                    <h2 className="mt-0.5 text-base font-extrabold text-slate-900">
                      {language === 'hi'
                        ? 'अपने चिकित्सक के साथ साझा करने के लिए तैयार'
                        : 'Ready to Share With Your Healthcare Provider'}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDoctorSummary(null)}
                    aria-label="Close doctor summary modal"
                    className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="mt-4 flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="markdown-clinical text-xs leading-relaxed text-slate-800">
                    <Markdown>{doctorSummary}</Markdown>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(doctorSummary);
                          setSummaryCopied(true);
                          setTimeout(() => setSummaryCopied(false), 2500);
                        } catch {
                          setSummaryCopied(false);
                        }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-teal-700 px-3.5 py-2 text-xs font-bold text-white hover:bg-teal-800"
                    >
                      {summaryCopied ? (
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      <span>{summaryCopied ? 'Copied' : 'Copy Summary'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadDoctorSummary}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50"
                    >
                      <Download className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                      <span>Download .txt</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const hasEmergency = messages.some((m) => m.emergency?.isEmergency);
                        void handleSaveCurrentSession(
                          'general_chat',
                          `Doctor Summary: ${(messages[0]?.text || 'Consultation').slice(0, 70)}`,
                          doctorSummary.slice(0, 3800),
                          hasEmergency ? 'emergency' : 'routine'
                        );
                        setDoctorSummary(null);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 px-3.5 py-2 text-xs font-bold text-teal-800 hover:bg-teal-100"
                    >
                      <BookmarkPlus className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Save with Consent</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================== TAB 2: MEDICINE PACKAGING SCANNER ==================== */}
      {mode === 'medicine' && (
        <div className="grid gap-5 lg:grid-cols-12">
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-5">
            <h2 className="text-base font-bold text-slate-900">
              {language === 'hi' ? 'दवा पैकेजिंग या लेबल स्कैन करें' : 'Scan Medicine Packaging or Label'}
            </h2>
            <p className="text-xs leading-relaxed text-slate-600">
              {language === 'hi'
                ? 'दवा की पट्टी, बोतल, सिरप पैकेजिंग या प्रिस्क्रिप्शन लेबल की स्पष्ट तस्वीर अपलोड करें। सुरक्षा कारणों से खुली गोलियों की पहचान नहीं की जाती और मूल तस्वीर स्थायी रूप से सहेजी नहीं जाती।'
                : 'Upload a clear photograph of medicine strips, boxes, syrup bottles, or prescription labels. Loose unmarked pills are never guessed, and photos are discarded after analysis.'}
            </p>

            <div className="flex flex-wrap gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-teal-700 px-4 py-2.5 text-xs font-bold text-white hover:bg-teal-800">
                <Upload className="h-4 w-4" aria-hidden="true" />
                <span>{language === 'hi' ? 'तस्वीर अपलोड करें' : 'Upload Packaging Photo'}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => void handleMedicineFile(e)}
                  className="sr-only"
                />
              </label>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
                <Camera className="h-4 w-4" aria-hidden="true" />
                <span>{language === 'hi' ? 'कैमरा उपयोग करें' : 'Use Camera'}</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => void handleMedicineFile(e)}
                  className="sr-only"
                />
              </label>
            </div>

            {medPreview && (
              <div className="space-y-3">
                <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={medPreview}
                    alt="Medicine packaging preview"
                    className="max-h-60 w-full object-contain"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setMedPreview(null);
                      setMedResult(null);
                    }}
                    aria-label="Remove medicine preview"
                    className="absolute top-2 right-2 rounded-lg bg-slate-900/75 p-1.5 text-white hover:bg-slate-900"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div>
                  <label htmlFor="med-note" className="block text-xs font-semibold text-slate-700">
                    {language === 'hi'
                      ? 'अतिरिक्त प्रश्न (वैकल्पिक)'
                      : 'Optional question about this packaging'}
                  </label>
                  <input
                    id="med-note"
                    type="text"
                    maxLength={400}
                    value={medNote}
                    onChange={(e) => setMedNote(e.target.value)}
                    placeholder={
                      language === 'hi'
                        ? 'जैसे: यह किस श्रेणी की दवा है?'
                        : 'e.g. What category of medicine is this?'
                    }
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900"
                  />
                </div>

                <button
                  type="button"
                  disabled={medLoading}
                  onClick={() => void runMedicineAnalysis()}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-3 text-xs font-bold text-white hover:bg-teal-800 disabled:opacity-60"
                >
                  {medLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Pill className="h-4 w-4" aria-hidden="true" />
                  )}
                  <span>
                    {medLoading
                      ? language === 'hi'
                        ? 'पैकेजिंग का विश्लेषण हो रहा है...'
                        : 'Analyzing packaging & cross-checking OpenFDA/WHO...'
                      : language === 'hi'
                        ? 'दवा पैकेजिंग विश्लेषण करें'
                        : 'Analyze Medicine Packaging'}
                  </span>
                </button>
              </div>
            )}

            {medError && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                {medError}
              </div>
            )}
          </div>

          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-7">
            <h2 className="text-base font-bold text-slate-900">
              {language === 'hi' ? 'दवा जानकारी एवं सुरक्षा समीक्षा' : 'Medicine Information & Safety Review'}
            </h2>

            {!medResult ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-xs leading-relaxed text-slate-500">
                {language === 'hi'
                  ? 'दवा का नाम, सक्रिय घटक, मात्रा, निर्माता, एक्सपायरी तिथि, सामान्य उपयोग और WHO/OpenFDA संदर्भ देखने के लिए बाईं ओर पैकेजिंग की तस्वीर अपलोड करें।'
                  : 'Upload a photograph on the left to inspect visible product name, active ingredients, printed strength, dosage form, manufacturer, expiry date, recognized uses, and verified clinical references.'}
              </div>
            ) : (
              <div className="space-y-4">
                {medResult.emergency?.isEmergency && (
                  <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-xs text-red-950">
                    <div className="font-extrabold">
                      {language === 'hi'
                        ? medResult.emergency.headlineHi
                        : medResult.emergency.headlineEn}
                    </div>
                    <p className="mt-1">
                      {language === 'hi'
                        ? medResult.emergency.guidanceHi
                        : medResult.emergency.guidanceEn}
                    </p>
                    <a
                      href="tel:112"
                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 font-bold text-white"
                    >
                      <PhoneCall className="h-3.5 w-3.5" aria-hidden="true" />
                      Call 112 Immediately
                    </a>
                  </div>
                )}

                {medResult.safetyReason && (
                  <div
                    className={`rounded-xl border p-3.5 text-xs font-medium ${
                      medResult.unidentified || medResult.isUncertain
                        ? 'border-amber-200 bg-amber-50 text-amber-950'
                        : 'border-teal-200 bg-teal-50 text-teal-950'
                    }`}
                  >
                    {medResult.safetyReason}
                  </div>
                )}

                {medResult.extraction && (
                  <div className="space-y-3">
                    <dl className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs sm:grid-cols-2">
                      <div>
                        <dt className="font-semibold text-slate-500">Possible Product Name</dt>
                        <dd className="mt-0.5 font-bold text-slate-900">
                          {medResult.extraction.productName}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-slate-500">Active Ingredient(s)</dt>
                        <dd className="mt-0.5 font-bold text-slate-900">
                          {medResult.extraction.activeIngredients.length > 0
                            ? medResult.extraction.activeIngredients.join(', ')
                            : 'Not clearly visible'}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-slate-500">Strength / Dosage Form</dt>
                        <dd className="mt-0.5 text-slate-800">
                          {medResult.extraction.strength} · {medResult.extraction.dosageForm}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-slate-500">Manufacturer &amp; Expiry</dt>
                        <dd className="mt-0.5 text-slate-800">
                          {medResult.extraction.manufacturer} · Exp: {medResult.extraction.expiryDate}
                        </dd>
                      </div>
                    </dl>

                    {!medResult.unidentified && (
                      <div className="space-y-2.5 text-xs leading-relaxed text-slate-700">
                        <div>
                          <span className="font-bold text-slate-900">Category: </span>
                          {medResult.extraction.category}
                        </div>
                        <div>
                          <span className="font-bold text-slate-900">Common Recognized Uses: </span>
                          {medResult.extraction.generalUses}
                        </div>
                        <div>
                          <span className="font-bold text-slate-900">
                            Why a Healthcare Professional May Prescribe It:{' '}
                          </span>
                          {medResult.extraction.whyPrescribed}
                        </div>
                        <div>
                          <span className="font-bold text-slate-900">
                            Why Doctor / Pharmacist Confirmation Matters:{' '}
                          </span>
                          {medResult.extraction.doctorPharmacistGuidance}
                        </div>
                        <div>
                          <span className="font-bold text-slate-900">
                            Missing or Unclear Packaging Details:{' '}
                          </span>
                          {medResult.extraction.missingOrUnclearDetails}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {medResult.clinicalReferences && medResult.clinicalReferences.length > 0 && (
                  <div className="space-y-2 border-t border-slate-100 pt-3">
                    <div className="text-[11px] font-bold text-teal-800 uppercase">
                      Cross-Checked Clinical Reference Sources
                    </div>
                    {medResult.clinicalReferences.map((ref, idx) => (
                      <div
                        key={idx}
                        className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs"
                      >
                        <div className="flex items-center gap-1.5 font-bold text-slate-900">
                          <CheckCircle2 className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                          <span>{ref.title}</span>
                        </div>
                        <div className="text-[11px] text-teal-800">{ref.source}</div>
                        <p className="mt-1 text-slate-600">{ref.commonUses}</p>
                        <p className="mt-1 text-slate-700">
                          <strong>Precautions:</strong> {ref.precautions}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {medResult.mandatorySafetyReminders && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs">
                    <div className="font-bold text-slate-900">Important Medicine Safety Rules</div>
                    <ul className="mt-1.5 list-disc space-y-1 pl-4 text-slate-700">
                      {medResult.mandatorySafetyReminders.map((r, idx) => (
                        <li key={idx}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      const name = medResult.extraction?.productName || 'Scanned Medicine';
                      const summary = `Product: ${name}\nIngredients: ${
                        medResult.extraction?.activeIngredients.join(', ') || 'Unclear'
                      }\nStrength: ${medResult.extraction?.strength || 'Unclear'}\nUses: ${
                        medResult.extraction?.generalUses || 'Verify with pharmacist'
                      }\nNote: Raw photograph was discarded and not saved.`;
                      void handleSaveCurrentSession(
                        'medicine_scan',
                        `Medicine Scan — ${name}`,
                        summary,
                        'routine'
                      );
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 px-3.5 py-2 text-xs font-bold text-teal-800 hover:bg-teal-100"
                  >
                    <BookmarkPlus className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{t.saveSessionBtn}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onFindHospital('pharmacy')}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                  >
                    <MapPin className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                    <span>
                      {language === 'hi' ? 'नजदीकी फ़ार्मेसी / डॉक्टर खोजें' : 'Find Nearby Pharmacy / Doctor'}
                    </span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== TAB 3: INJURY IMAGE ANALYZER ==================== */}
      {mode === 'injury' && (
        <div className="grid gap-5 lg:grid-cols-12">
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-5">
            <h2 className="text-base font-bold text-slate-900">
              {language === 'hi'
                ? 'दृश्य चोट का सीमित अवलोकन'
                : 'Limited Visible Injury Observation'}
            </h2>
            <p className="text-xs leading-relaxed text-slate-600">
              {language === 'hi'
                ? 'यह उपकरण केवल सतह पर दिखने वाले सामान्य संकेतों का वर्णन करता है और हड्डी टूटने, आंतरिक चोट या संक्रमण का निदान नहीं कर सकता। यदि अत्यधिक रक्तस्राव, गंभीर जलन या सिर की चोट है तो तुरंत 112 पर कॉल करें।'
                : 'This tool offers calm, non-diagnostic surface observations only. A photo cannot diagnose fractures, internal injury, or infection. For heavy bleeding, deep burns, or head trauma, call 112 immediately.'}
            </p>

            <div className="flex flex-wrap gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-teal-700 px-4 py-2.5 text-xs font-bold text-white hover:bg-teal-800">
                <Upload className="h-4 w-4" aria-hidden="true" />
                <span>{language === 'hi' ? 'चोट की तस्वीर चुनें' : 'Upload Injury Photo'}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => void handleInjuryFile(e)}
                  className="sr-only"
                />
              </label>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
                <Camera className="h-4 w-4" aria-hidden="true" />
                <span>{language === 'hi' ? 'कैमरा उपयोग करें' : 'Use Camera'}</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => void handleInjuryFile(e)}
                  className="sr-only"
                />
              </label>
            </div>

            {injPreview && (
              <div className="space-y-3">
                <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={injPreview}
                    alt="Uploaded injury preview"
                    className="max-h-60 w-full object-contain"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setInjPreview(null);
                      setInjResult(null);
                    }}
                    aria-label="Remove injury preview"
                    className="absolute top-2 right-2 rounded-lg bg-slate-900/75 p-1.5 text-white hover:bg-slate-900"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div>
                  <label htmlFor="inj-desc" className="block text-xs font-semibold text-slate-700">
                    {language === 'hi'
                      ? 'यह कब और कैसे हुआ? (वैकल्पिक विवरण)'
                      : 'How & when did this happen? (Optional context)'}
                  </label>
                  <textarea
                    id="inj-desc"
                    rows={2}
                    maxLength={600}
                    value={injDesc}
                    onChange={(e) => setInjDesc(e.target.value)}
                    placeholder={
                      language === 'hi'
                        ? 'जैसे: 2 घंटे पहले गिरने से हल्की खरोंच और सूजन...'
                        : 'e.g. Scraped knee after tripping 2 hours ago, mild swelling...'
                    }
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900"
                  />
                </div>

                <button
                  type="button"
                  disabled={injLoading}
                  onClick={() => void runInjuryAnalysis()}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-3 text-xs font-bold text-white hover:bg-teal-800 disabled:opacity-60"
                >
                  {injLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Camera className="h-4 w-4" aria-hidden="true" />
                  )}
                  <span>
                    {injLoading
                      ? language === 'hi'
                        ? 'दृश्य अवलोकन किया जा रहा है...'
                        : 'Performing limited visual observation...'
                      : language === 'hi'
                        ? 'दृश्य अवलोकन देखें'
                        : 'Review Visual Observations'}
                  </span>
                </button>
              </div>
            )}

            {injError && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                {injError}
              </div>
            )}
          </div>

          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-7">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold text-slate-900">
                {language === 'hi'
                  ? 'अवलोकन, सीमाएं और अगले कदम'
                  : 'Observations, Limitations & Next Steps'}
              </h2>
              <button
                type="button"
                onClick={() => onFindHospital('emergency_hospital')}
                className="inline-flex items-center gap-1.5 rounded-xl bg-teal-700 px-3.5 py-2 text-xs font-bold text-white hover:bg-teal-800"
              >
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{t.findHospital}</span>
              </button>
            </div>

            {!injResult ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-xs leading-relaxed text-slate-500">
                {language === 'hi'
                  ? 'तस्वीर अपलोड करने के बाद SAHAAY गैर-नैदानिक दृश्य अवलोकन, स्पष्ट सीमाएं और डॉक्टर/अस्पताल कब जाएं इसकी जानकारी दिखाएगा।'
                  : 'Once you upload a photo, SAHAAY will provide non-diagnostic visual observations, clearly explain what cannot be determined from an image, and help you decide when to visit a clinic or hospital.'}
              </div>
            ) : injResult.stoppedForEmergency && injResult.emergency ? (
              <div className="rounded-2xl border border-red-300 bg-red-50 p-5 text-red-950">
                <div className="flex items-center gap-2 text-sm font-extrabold">
                  <ShieldAlert className="h-5 w-5 text-red-600" aria-hidden="true" />
                  <span>
                    {language === 'hi'
                      ? injResult.emergency.headlineHi
                      : injResult.emergency.headlineEn}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-relaxed">
                  {language === 'hi'
                    ? injResult.emergency.guidanceHi
                    : injResult.emergency.guidanceEn}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <a
                    href="tel:112"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2.5 text-xs font-bold text-white"
                  >
                    <PhoneCall className="h-4 w-4" aria-hidden="true" />
                    Call 112 Now
                  </a>
                  <button
                    type="button"
                    onClick={() => onFindHospital('emergency_hospital')}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-teal-700 px-4 py-2.5 text-xs font-bold text-white"
                  >
                    <MapPin className="h-4 w-4" aria-hidden="true" />
                    {t.findHospital}
                  </button>
                </div>
              </div>
            ) : (
              injResult.result && (
                <div className="space-y-4 text-xs leading-relaxed">
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-amber-950">
                    <strong className="font-bold">Important Limitation: </strong>
                    {injResult.result.limitationsExplanation}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                      <div className="font-bold text-slate-900">Visible Surface Observations</div>
                      <ul className="mt-1.5 list-disc space-y-1 pl-4 text-slate-700">
                        {injResult.result.visibleObservations.map((o, i) => (
                          <li key={i}>{o}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                      <div className="font-bold text-slate-900">Cannot Be Determined From Photo</div>
                      <ul className="mt-1.5 list-disc space-y-1 pl-4 text-slate-700">
                        {injResult.result.cannotDetermineFromImage.map((o, i) => (
                          <li key={i}>{o}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                    <div className="font-bold text-slate-900">General Next Steps &amp; Follow-Up Questions</div>
                    <ul className="mt-1.5 list-disc space-y-1 pl-4 text-slate-700">
                      {injResult.result.generalNextSteps.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                    {injResult.result.followUpQuestions.length > 0 && (
                      <div className="mt-3 border-t border-slate-100 pt-2.5">
                        <div className="font-semibold text-teal-800">
                          Helpful Questions to Consider for Your Doctor:
                        </div>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-slate-600">
                          {injResult.result.followUpQuestions.map((q, i) => (
                            <li key={i}>{q}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-teal-200 bg-teal-50/50 p-3.5">
                      <div className="font-bold text-teal-950">When to Consult a Doctor</div>
                      <ul className="mt-1.5 list-disc space-y-1 pl-4 text-slate-700">
                        {injResult.result.whenToSeeDoctor.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-xl border border-red-200 bg-red-50/70 p-3.5">
                      <div className="font-bold text-red-900">When Immediate Emergency Care Is Needed</div>
                      <ul className="mt-1.5 list-disc space-y-1 pl-4 text-red-900">
                        {injResult.result.whenEmergencyNeeded.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => onFindHospital('emergency_hospital')}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-teal-700 px-4 py-2.5 text-xs font-bold text-white hover:bg-teal-800"
                    >
                      <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{t.findHospital}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const summary = `Visible Observations: ${injResult.result!.visibleObservations.join(
                          '; '
                        )}\nLimitations: ${injResult.result!.limitationsExplanation}\nNext Steps: ${injResult.result!.generalNextSteps.join(
                          '; '
                        )}\nNote: Raw injury photograph was immediately discarded and not saved.`;
                        void handleSaveCurrentSession(
                          'injury_analysis',
                          'Injury Observation Summary',
                          summary,
                          injResult.result!.recommendHospitalVisit ? 'urgent' : 'soon'
                        );
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 px-3.5 py-2.5 text-xs font-bold text-teal-800 hover:bg-teal-100"
                    >
                      <BookmarkPlus className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{t.saveSessionBtn}</span>
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* ==================== TAB 4: BILINGUAL VOICE CONVERSATION ==================== */}
      {mode === 'voice' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                {language === 'hi'
                  ? 'द्विभाषी वॉइस स्वास्थ्य बातचीत (हिन्दी / English)'
                  : 'Bilingual Voice Health Conversation (Hindi / English)'}
              </h2>
              <p className="mt-0.5 text-xs text-slate-600">
                {language === 'hi'
                  ? 'माइक्रोफ़ोन दबाकर बोलें। SAHAAY आपकी आवाज़ को समझेगा, टेक्स्ट दिखाएगा और शांत आवाज़ में उत्तर देगा।'
                  : 'Tap the microphone to speak naturally in Hindi or English. SAHAAY transcribes your speech and responds in voice and text.'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Voice recognition language"
                value={voiceLang}
                onChange={(e) => setVoiceLang(e.target.value as 'auto' | 'en' | 'hi')}
                className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-800"
              >
                <option value="auto">Auto (Hindi / English)</option>
                <option value="en">English</option>
                <option value="hi">हिन्दी (Hindi)</option>
              </select>

              <button
                type="button"
                onClick={() => {
                  if (!voiceMuted) stopAudioPlayback();
                  setVoiceMuted(!voiceMuted);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                {voiceMuted ? (
                  <>
                    <VolumeX className="h-3.5 w-3.5 text-red-600" aria-hidden="true" />
                    <span>Muted</span>
                  </>
                ) : (
                  <>
                    <Volume2 className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                    <span>Audio On</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setMode('chat')}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <span>{language === 'hi' ? 'टेक्स्ट चैट पर जाएं' : 'Switch to Text'}</span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Primary Microphone Control */}
          <div className="mt-6 flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center">
            <button
              type="button"
              disabled={voiceBusy}
              onClick={() => (isRecording ? stopVoiceRecording() : void startVoiceRecording())}
              aria-label={isRecording ? 'Stop recording' : 'Start speaking'}
              className={`flex h-20 w-20 items-center justify-center rounded-full shadow-md transition ${
                isRecording
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-teal-700 text-white hover:bg-teal-800'
              } disabled:opacity-50`}
            >
              {voiceBusy ? (
                <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
              ) : isRecording ? (
                <Square className="h-7 w-7" aria-hidden="true" />
              ) : (
                <Mic className="h-8 w-8" aria-hidden="true" />
              )}
            </button>

            <div className="mt-3 text-sm font-bold text-slate-900">
              {voiceBusy
                ? language === 'hi'
                  ? 'प्रोसेस हो रहा है...'
                  : 'Transcribing and preparing response...'
                : isRecording
                  ? language === 'hi'
                    ? 'सुन रहा हूँ — समाप्त करने के लिए दबाएं'
                    : 'Listening — tap again when finished'
                  : language === 'hi'
                    ? 'बोलने के लिए माइक्रोफ़ोन दबाएं'
                    : 'Tap microphone to speak in Hindi or English'}
            </div>

            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {isSpeaking && (
                <button
                  type="button"
                  onClick={stopAudioPlayback}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-red-700"
                >
                  <MicOff className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{language === 'hi' ? 'आवाज़ रोकें' : 'Interrupt / Stop Speech'}</span>
                </button>
              )}
              {lastSpokenText && !isSpeaking && (
                <button
                  type="button"
                  onClick={() => void playTtsAudio(lastSpokenText, lastSpokenLang)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-teal-200 bg-white px-3.5 py-2 text-xs font-bold text-teal-800 hover:bg-teal-50"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{language === 'hi' ? 'उत्तर दोबारा सुनें' : 'Repeat Last Response'}</span>
                </button>
              )}
              {voiceTurns.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const transcript = voiceTurns
                      .map((v) => `${v.role === 'user' ? 'User' : 'SAHAAY'}: ${v.text}`)
                      .join('\n\n');
                    void handleSaveCurrentSession(
                      'voice_session',
                      `Voice Session — ${voiceTurns[0].text.slice(0, 70)}`,
                      voiceTurns[voiceTurns.length - 1].text.slice(0, 1200),
                      voiceTurns.some((v) => v.emergency?.isEmergency) ? 'emergency' : 'routine',
                      transcript
                    );
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-3.5 py-2 text-xs font-bold text-teal-800 hover:bg-teal-100"
                >
                  <BookmarkPlus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    {language === 'hi' ? 'सहमति से ट्रांसक्रिप्ट सहेजें' : 'Save Consented Transcript'}
                  </span>
                </button>
              )}
            </div>

            {voiceError && (
              <div className="mt-4 max-w-lg rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                {voiceError}
              </div>
            )}
          </div>

          {/* Live Transcript Display */}
          {voiceTurns.length > 0 && (
            <div className="mt-5 space-y-3">
              <h3 className="text-xs font-bold tracking-wide text-slate-500 uppercase">
                Live Conversation Transcript
              </h3>
              {voiceTurns.map((turn, idx) => (
                <div
                  key={idx}
                  className={`rounded-xl border p-3.5 text-xs leading-relaxed ${
                    turn.role === 'user'
                      ? 'border-slate-200 bg-slate-50 text-slate-900'
                      : turn.emergency?.isEmergency
                        ? 'border-red-300 bg-red-50 text-red-950'
                        : 'border-teal-100 bg-teal-50/40 text-slate-800'
                  }`}
                >
                  <div className="mb-1 font-bold text-slate-700">
                    {turn.role === 'user' ? 'You (Transcribed)' : 'SAHAAY Assistant'}
                  </div>
                  <div className="markdown-clinical">
                    <Markdown>{turn.text}</Markdown>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ==================== TAB 5: CLINICIAN-REVIEWED REFERENCE DATABASE ==================== */}
      {mode === 'reference' && (
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              {language === 'hi'
                ? 'सत्यापित चिकित्सा संदर्भ डेटाबेस (WHO / OpenFDA / NIH MedlinePlus)'
                : 'Clinician-Reviewed Medical Reference Database'}
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              {language === 'hi'
                ? 'विश्वसनीय सार्वजनिक स्रोतों (WHO Essential Medicines / NLEM India, U.S. FDA OpenFDA Drug Labels, और NIH MedlinePlus) से सामान्य दवा उपयोग और स्वास्थ्य सावधानियां खोजें।'
                : 'Search trustworthy, clinician-reviewed public databases (WHO Essential Medicines / India NLEM, U.S. FDA OpenFDA Drug Labeling, and NIH NLM MedlinePlus) for medicine uses and precautions.'}
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void runReferenceSearch();
            }}
            className="flex flex-col gap-2.5 sm:flex-row"
          >
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={refQuery}
                onChange={(e) => setRefQuery(e.target.value)}
                aria-label="Search medicine or health topic in clinical reference database"
                placeholder="Search medicine or topic (e.g., Paracetamol, Metformin, ORS, Asthma, Fever)..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pr-4 pl-10 text-sm text-slate-900 focus:border-teal-600 focus:bg-white focus:outline-none"
              />
            </div>

            <select
              aria-label="Reference lookup type"
              value={refKind}
              onChange={(e) => setRefKind(e.target.value as 'medicine' | 'topic')}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-semibold text-slate-800"
            >
              <option value="medicine">Medicine / Drug</option>
              <option value="topic">Health Topic</option>
            </select>

            <button
              type="submit"
              disabled={refLoading || refQuery.trim().length < 2}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-teal-700 px-5 py-2.5 text-xs font-bold text-white hover:bg-teal-800 disabled:opacity-50"
            >
              {refLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Search className="h-4 w-4" aria-hidden="true" />
              )}
              <span>Search References</span>
            </button>
          </form>

          <div className="flex flex-wrap gap-2">
            {[
              { q: 'Paracetamol', k: 'medicine' as const },
              { q: 'Metformin', k: 'medicine' as const },
              { q: 'Amoxicillin', k: 'medicine' as const },
              { q: 'ORS', k: 'medicine' as const },
              { q: 'Dehydration', k: 'topic' as const },
            ].map((item) => (
              <button
                key={item.q}
                type="button"
                onClick={() => void runReferenceSearch(item.q, item.k)}
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-teal-600 hover:text-teal-800"
              >
                {item.q}
              </button>
            ))}
          </div>

          {refError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
              {refError}
            </div>
          )}

          {refSources.length > 0 && (
            <div className="text-[11px] text-slate-500">
              Sources checked: {refSources.join(' · ')}
            </div>
          )}

          {refResults.length > 0 && (
            <div className="space-y-3">
              {refResults.map((item, idx) => (
                <article
                  key={idx}
                  className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-xs"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">{item.title}</h3>
                      <div className="mt-0.5 font-semibold text-teal-800">{item.source}</div>
                    </div>
                    {item.url && (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-semibold text-teal-700 hover:underline"
                      >
                        <span>Official Source</span>
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    )}
                  </div>
                  {item.category && (
                    <div className="mt-2 text-slate-600">
                      <strong className="text-slate-800">Category:</strong> {item.category}
                    </div>
                  )}
                  <p className="mt-2 leading-relaxed text-slate-700">
                    <strong className="text-slate-900">Common Uses / Summary: </strong>
                    {item.commonUses}
                  </p>
                  <p className="mt-2 leading-relaxed text-slate-700">
                    <AlertTriangle
                      className="mr-1 inline h-3.5 w-3.5 text-amber-600"
                      aria-hidden="true"
                    />
                    <strong className="text-slate-900">Precautions: </strong>
                    {item.precautions}
                  </p>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ==================== TAB 6: AI LAB REPORT ANALYZER ==================== */}
      {mode === 'lab_report' && (
        <LabReportAnalyzer
          language={language}
          onFindHospital={onFindHospital}
          onSaveSummary={async (title, summary) => {
            await handleSaveCurrentSession('general_chat', title, summary, 'routine');
          }}
        />
      )}

      {/* ==================== TAB 7: AI PRESCRIPTION READER ==================== */}
      {mode === 'prescription' && (
        <PrescriptionReader
          language={language}
          onSendToSafetyChecker={(meds) => {
            setSafetySeedMedicines(meds);
            setMode('safety_check');
          }}
          onSaveSummary={async (title, summary) => {
            await handleSaveCurrentSession('medicine_scan', title, summary, 'routine');
          }}
        />
      )}

      {/* ==================== TAB 8: MEDICINE SAFETY CHECKER ==================== */}
      {mode === 'safety_check' && (
        <MedicineSafetyChecker language={language} initialMedicines={safetySeedMedicines} />
      )}

      {/* Inline Flag Potentially Incorrect AI Answer Modal */}
      {flaggingMsg && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Report potentially incorrect AI answer"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[11px] font-bold text-amber-800 uppercase">
                  AI Response Quality Review
                </div>
                <h3 className="mt-0.5 text-base font-extrabold text-slate-900">
                  Report Potentially Incorrect Answer
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setFlaggingMsg(null)}
                aria-label="Close report dialog"
                className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-600">
              Help improve SAHAAY medical accuracy. Flagged responses are logged for review in the Admin AI Quality Monitor.
            </p>
            <textarea
              rows={3}
              value={flagReason}
              onChange={(e) => setFlagReason(e.target.value)}
              placeholder="Briefly describe what looks inaccurate, outdated, or missing..."
              className="mt-3 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-900 focus:border-teal-600 focus:bg-white focus:outline-none"
            />
            {flagDone && (
              <div className="mt-2 rounded-lg bg-emerald-50 p-2.5 text-xs font-semibold text-emerald-800">
                {flagDone}
              </div>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setFlaggingMsg(null)}
                className="rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
              <button
                type="button"
                disabled={flagBusy || flagReason.trim().length < 5}
                onClick={async () => {
                  setFlagBusy(true);
                  try {
                    const res = await fetch('/api/medical/answer-report', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        questionSnippet: messages[0]?.text?.slice(0, 400) || 'Medical chat answer',
                        answerSnippet: flaggingMsg.text.slice(0, 800),
                        issueCategory: 'inaccurate_medical_info',
                        details: flagReason.trim(),
                        sourceCited: flaggingMsg.references?.[0]?.source || 'AI Chat Response',
                      }),
                    });
                    const data = await res.json();
                    if (res.ok) {
                      setFlagDone(data.message || 'Submitted for clinical quality review.');
                      setFlagReason('');
                    }
                  } finally {
                    setFlagBusy(false);
                  }
                }}
                className="rounded-xl bg-teal-700 px-4 py-2 text-xs font-bold text-white hover:bg-teal-800 disabled:opacity-50"
              >
                {flagBusy ? 'Submitting...' : 'Submit Report'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
