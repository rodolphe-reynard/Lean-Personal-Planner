import React, { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Lock, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useAppState } from '../context/AppStateContext';
import {
  FixedActivity,
  FixedActivityKind,
  RecurrenceFrequency,
  ValueCategory,
} from '../types';
import {
  formatDuration,
  formatMinutesToTime,
  formatShortDate,
  isValidDateString,
} from '../utils/dateUtils';
import { expandFixedActivityDates } from '../utils/schedulingUtils';
import { useLanguage } from '../i18n/LanguageContext';

interface FixedActivityModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialEditActivityId?: string | null;
}

const SAT_TO_FRI_DAY_NUMS: number[] = [6, 0, 1, 2, 3, 4, 5];

const TIME_SLOTS: number[] = Array.from({ length: (22 - 7) * 2 + 1 }, (_, i) => 7 * 60 + i * 30);

export const FixedActivityModal: React.FC<FixedActivityModalProps> = ({
  isOpen,
  onClose,
  initialEditActivityId = null,
}) => {
  const {
    fixedActivities,
    todayStr,
    displayedWeekStart,
    workCapacity,
    createFixedActivity,
    updateFixedActivity,
    deleteFixedActivity,
    updateWorkCapacity,
  } = useAppState();
  const { t, language } = useLanguage();

  const [activeSection, setActiveSection] = useState<'activities' | 'capacity'>('activities');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [listFilter, setListFilter] = useState<'upcoming' | 'all'>('upcoming');

  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<FixedActivityKind>('class');
  const [singleDate, setSingleDate] = useState(todayStr);
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1, 3]);
  const [startMinutes, setStartMinutes] = useState(9 * 60);
  const [endMinutes, setEndMinutes] = useState(10 * 60);
  const [recurrence, setRecurrence] = useState<RecurrenceFrequency>('weekly');
  const [startDate, setStartDate] = useState(displayedWeekStart);
  const [endDate, setEndDate] = useState('');
  const [countsAsWorkingTime, setCountsAsWorkingTime] = useState(true);
  const [valueCategory, setValueCategory] = useState<ValueCategory>('NNVA');
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setEditingId(null);
    setTitle('');
    setKind('class');
    setSingleDate(todayStr);
    setDaysOfWeek([1, 3]);
    setStartMinutes(9 * 60);
    setEndMinutes(10 * 60);
    setRecurrence('weekly');
    setStartDate(displayedWeekStart);
    setEndDate('');
    setCountsAsWorkingTime(true);
    setValueCategory('NNVA');
    setError(null);
  };

  useEffect(() => {
    if (!isOpen) return;
    if (initialEditActivityId) {
      const target = fixedActivities.find((fa) => fa.id === initialEditActivityId);
      if (target) {
        setActiveSection('activities');
        setEditingId(target.id);
        setTitle(target.title);
        setKind(target.kind);
        setSingleDate(target.date);
        setStartMinutes(target.startMinutes);
        setEndMinutes(target.endMinutes);
        setCountsAsWorkingTime(target.countsAsWorkingTime);
        setValueCategory(target.valueCategory);
        setError(null);
      } else {
        resetForm();
      }
    } else {
      resetForm();
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, initialEditActivityId, todayStr, displayedWeekStart, onClose]);

  const previewCount = useMemo(() => {
    if (editingId) return 1;
    if (recurrence === 'once') return 1;
    if (daysOfWeek.length === 0) return 0;
    return expandFixedActivityDates({
      startDate,
      endDate: endDate || undefined,
      recurrence,
      daysOfWeek,
    }).length;
  }, [editingId, recurrence, daysOfWeek, startDate, endDate]);

  const sortedInstances = useMemo(() => {
    return [...fixedActivities]
      .filter((fa) => (listFilter === 'upcoming' ? fa.date >= todayStr : true))
      .sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes);
  }, [fixedActivities, listFilter, todayStr]);

  if (!isOpen) return null;

  const handleKindChange = (nextKind: FixedActivityKind) => {
    setKind(nextKind);
    const isWorking = nextKind === 'class' || nextKind === 'meeting';
    setCountsAsWorkingTime(isWorking);
    setValueCategory(isWorking ? 'NNVA' : 'NVA');
  };

  const toggleDay = (dayNum: number) => {
    setDaysOfWeek((prev) =>
      prev.includes(dayNum) ? prev.filter((d) => d !== dayNum) : [...prev, dayNum]
    );
  };

  const loadForEdit = (fa: FixedActivity) => {
    setEditingId(fa.id);
    setTitle(fa.title);
    setKind(fa.kind);
    setSingleDate(fa.date);
    setStartMinutes(fa.startMinutes);
    setEndMinutes(fa.endMinutes);
    setCountsAsWorkingTime(fa.countsAsWorkingTime);
    setValueCategory(fa.valueCategory);
    setError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError(t.fixedModal.errNoTitle);
      return;
    }
    if (endMinutes <= startMinutes) {
      setError(t.fixedModal.errEndTime);
      return;
    }

    if (editingId) {
      if (!isValidDateString(singleDate)) {
        setError(t.fixedModal.errInvalidDate);
        return;
      }
      updateFixedActivity(editingId, {
        title: trimmed,
        kind,
        date: singleDate,
        startMinutes,
        endMinutes,
        countsAsWorkingTime,
        valueCategory,
      });
    } else {
      if (recurrence !== 'once' && daysOfWeek.length === 0) {
        setError(t.fixedModal.errNoDays);
        return;
      }
      createFixedActivity({
        title: trimmed,
        kind,
        daysOfWeek,
        startMinutes,
        endMinutes,
        recurrence,
        startDate: recurrence === 'once' ? singleDate : startDate,
        endDate: endDate || undefined,
        countsAsWorkingTime,
        valueCategory,
      });
    }
    resetForm();
  };

  const toggleWorkday = (dayNum: number) => {
    const next = workCapacity.workdays.includes(dayNum)
      ? workCapacity.workdays.filter((d) => d !== dayNum)
      : [...workCapacity.workdays, dayNum];
    updateWorkCapacity({ workdays: next });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fixed-activities-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] flex flex-col bg-white border border-zinc-200 rounded-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-zinc-700" />
              <h2 id="fixed-activities-title" className="text-base font-semibold text-zinc-900">
                {t.fixedModal.title}
              </h2>
            </div>
            <div className="flex items-center gap-1 p-0.5 bg-zinc-100 rounded-md border border-zinc-200">
              <button
                type="button"
                onClick={() => setActiveSection('activities')}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  activeSection === 'activities'
                    ? 'bg-white text-zinc-900 shadow-xs'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                {t.fixedModal.tabInstances(fixedActivities.length)}
              </button>
              <button
                type="button"
                onClick={() => setActiveSection('capacity')}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  activeSection === 'capacity'
                    ? 'bg-white text-zinc-900 shadow-xs'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                {t.fixedModal.tabCapacity}
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-700 rounded-md"
            aria-label={t.common.closeModal}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {activeSection === 'activities' ? (
            <div className="grid grid-cols-1 md:grid-cols-[1.1fr_1fr] gap-6">
              {/* Left: Create Batch OR Edit Single Concrete Instance */}
              <form onSubmit={handleSubmit} className="space-y-3.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    {editingId ? t.fixedModal.editHeading : t.fixedModal.createHeading}
                  </h3>
                  {editingId && (
                    <button
                      type="button"
                      onClick={resetForm}
                      className="text-xs font-medium text-zinc-600 hover:text-zinc-900 underline"
                    >
                      {t.fixedModal.cancelEdit}
                    </button>
                  )}
                </div>

                {editingId && (
                  <p className="text-[11px] text-zinc-500 bg-zinc-50 border border-zinc-200 rounded px-2.5 py-1.5">
                    {t.fixedModal.editNote}
                  </p>
                )}

                {error && (
                  <div className="px-3 py-2 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md">
                    {error}
                  </div>
                )}

                <div>
                  <label htmlFor="fa-title" className="block text-xs font-medium text-zinc-700 mb-1">
                    {t.fixedModal.titleLabel}
                  </label>
                  <input
                    id="fa-title"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t.fixedModal.titlePlaceholder}
                    className="w-full px-3 py-2 text-sm text-zinc-900 bg-white border border-zinc-300 rounded-md focus:outline-none focus:border-zinc-900"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="fa-kind" className="block text-xs font-medium text-zinc-700 mb-1">
                      {t.fixedModal.typeLabel}
                    </label>
                    <select
                      id="fa-kind"
                      value={kind}
                      onChange={(e) => handleKindChange(e.target.value as FixedActivityKind)}
                      className="w-full px-2.5 py-2 text-xs text-zinc-900 bg-white border border-zinc-300 rounded-md focus:outline-none focus:border-zinc-900"
                    >
                      <option value="class">{t.fixedModal.kinds.class}</option>
                      <option value="meeting">{t.fixedModal.kinds.meeting}</option>
                      <option value="lunch">{t.fixedModal.kinds.lunch}</option>
                      <option value="non_working">{t.fixedModal.kinds.non_working}</option>
                    </select>
                  </div>

                  {!editingId ? (
                    <div>
                      <label htmlFor="fa-rec" className="block text-xs font-medium text-zinc-700 mb-1">
                        {t.fixedModal.patternLabel}
                      </label>
                      <select
                        id="fa-rec"
                        value={recurrence}
                        onChange={(e) => setRecurrence(e.target.value as RecurrenceFrequency)}
                        className="w-full px-2.5 py-2 text-xs text-zinc-900 bg-white border border-zinc-300 rounded-md focus:outline-none focus:border-zinc-900"
                      >
                        <option value="weekly">{t.fixedModal.patterns.weekly}</option>
                        <option value="biweekly">{t.fixedModal.patterns.biweekly}</option>
                        <option value="once">{t.fixedModal.patterns.once}</option>
                      </select>
                    </div>
                  ) : (
                    <div>
                      <label htmlFor="fa-single-date" className="block text-xs font-medium text-zinc-700 mb-1">
                        {t.fixedModal.dateLabel}
                      </label>
                      <input
                        id="fa-single-date"
                        type="date"
                        value={singleDate}
                        onChange={(e) => setSingleDate(e.target.value)}
                        className="w-full px-2.5 py-2 text-xs font-mono tabular-nums text-zinc-900 bg-white border border-zinc-300 rounded-md focus:outline-none focus:border-zinc-900"
                      />
                    </div>
                  )}
                </div>

                {!editingId && recurrence !== 'once' && (
                  <div>
                    <span className="block text-xs font-medium text-zinc-700 mb-1.5">
                      {t.fixedModal.daysLabel}
                    </span>
                    <div className="grid grid-cols-7 gap-1">
                      {SAT_TO_FRI_DAY_NUMS.map((dayNum, idx) => {
                        const selected = daysOfWeek.includes(dayNum);
                        return (
                          <button
                            key={dayNum}
                            type="button"
                            onClick={() => toggleDay(dayNum)}
                            aria-pressed={selected}
                            className={`py-1.5 text-[11px] font-medium rounded border transition-colors ${
                              selected
                                ? 'bg-zinc-900 text-white border-zinc-900'
                                : 'bg-white text-zinc-700 border-zinc-300 hover:border-zinc-500'
                            }`}
                          >
                            {t.fixedModal.daysSatToFri[idx]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="fa-start-time" className="block text-xs font-medium text-zinc-700 mb-1">
                      {t.fixedModal.startTimeLabel}
                    </label>
                    <select
                      id="fa-start-time"
                      value={startMinutes}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setStartMinutes(val);
                        if (endMinutes <= val) setEndMinutes(Math.min(22 * 60, val + 60));
                      }}
                      className="w-full px-2.5 py-2 text-xs font-mono tabular-nums text-zinc-900 bg-white border border-zinc-300 rounded-md focus:outline-none focus:border-zinc-900"
                    >
                      {TIME_SLOTS.slice(0, -1).map((m) => (
                        <option key={m} value={m}>
                          {formatMinutesToTime(m)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="fa-end-time" className="block text-xs font-medium text-zinc-700 mb-1">
                      {t.fixedModal.endTimeLabel}
                    </label>
                    <select
                      id="fa-end-time"
                      value={endMinutes}
                      onChange={(e) => setEndMinutes(Number(e.target.value))}
                      className="w-full px-2.5 py-2 text-xs font-mono tabular-nums text-zinc-900 bg-white border border-zinc-300 rounded-md focus:outline-none focus:border-zinc-900"
                    >
                      {TIME_SLOTS.filter((m) => m > startMinutes).map((m) => (
                        <option key={m} value={m}>
                          {formatMinutesToTime(m)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {!editingId && (
                  <div className="grid grid-cols-2 gap-3">
                    {recurrence === 'once' ? (
                      <div className="col-span-2">
                        <label htmlFor="fa-once-date" className="block text-xs font-medium text-zinc-700 mb-1">
                          {t.fixedModal.dateLabel}
                        </label>
                        <input
                          id="fa-once-date"
                          type="date"
                          value={singleDate}
                          onChange={(e) => setSingleDate(e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums text-zinc-900 bg-white border border-zinc-300 rounded-md focus:outline-none focus:border-zinc-900"
                        />
                      </div>
                    ) : (
                      <>
                        <div>
                          <label htmlFor="fa-start-date" className="block text-xs font-medium text-zinc-700 mb-1">
                            {t.fixedModal.startDateLabel}
                          </label>
                          <input
                            id="fa-start-date"
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums text-zinc-900 bg-white border border-zinc-300 rounded-md focus:outline-none focus:border-zinc-900"
                          />
                        </div>
                        <div>
                          <label htmlFor="fa-end-date" className="block text-xs font-medium text-zinc-700 mb-1">
                            {t.fixedModal.endDateLabel}
                          </label>
                          <input
                            id="fa-end-date"
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums text-zinc-900 bg-white border border-zinc-300 rounded-md focus:outline-none focus:border-zinc-900"
                          />
                        </div>
                      </>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-[1fr_110px] gap-3 items-center pt-1">
                  <label className="flex items-start gap-2 text-xs text-zinc-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={countsAsWorkingTime}
                      onChange={(e) => setCountsAsWorkingTime(e.target.checked)}
                      className="mt-0.5 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                    />
                    <span>
                      <span className="font-medium text-zinc-900 block">
                        {t.fixedModal.countsWorkingLabel}
                      </span>
                      <span className="text-[11px] text-zinc-500">
                        {t.fixedModal.countsWorkingHint}
                      </span>
                    </span>
                  </label>

                  <div>
                    <label htmlFor="fa-lean" className="block text-[11px] font-medium text-zinc-600 mb-1">
                      {t.fixedModal.leanClassLabel}
                    </label>
                    <select
                      id="fa-lean"
                      value={valueCategory}
                      onChange={(e) => setValueCategory(e.target.value as ValueCategory)}
                      className="w-full px-2 py-1.5 text-xs font-mono text-zinc-900 bg-white border border-zinc-300 rounded-md"
                    >
                      <option value="VA">VA</option>
                      <option value="NNVA">NNVA</option>
                      <option value="NVA">NVA</option>
                    </select>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-zinc-900 rounded-md hover:bg-zinc-800 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {editingId
                      ? t.fixedModal.saveOccurrence
                      : previewCount > 1
                      ? t.fixedModal.createOccurrences(previewCount)
                      : t.fixedModal.addFixedBtn}
                  </button>
                </div>
              </form>

              {/* Right: Individual Concrete Fixed Activity Occurrences */}
              <div className="space-y-3 border-t md:border-t-0 md:border-l border-zinc-200 pt-5 md:pt-0 md:pl-6">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    {t.fixedModal.occurrencesHeading}
                  </h3>
                  <div className="inline-flex items-center p-0.5 bg-zinc-100 rounded border border-zinc-200 text-[10px] font-medium">
                    <button
                      type="button"
                      onClick={() => setListFilter('upcoming')}
                      className={`px-2 py-0.5 rounded ${
                        listFilter === 'upcoming' ? 'bg-white text-zinc-900' : 'text-zinc-500'
                      }`}
                    >
                      {t.fixedModal.upcoming}
                    </button>
                    <button
                      type="button"
                      onClick={() => setListFilter('all')}
                      className={`px-2 py-0.5 rounded ${
                        listFilter === 'all' ? 'bg-white text-zinc-900' : 'text-zinc-500'
                      }`}
                    >
                      {t.fixedModal.allCount(fixedActivities.length)}
                    </button>
                  </div>
                </div>

                {sortedInstances.length === 0 ? (
                  <div className="p-6 border border-dashed border-zinc-300 rounded-md text-center text-xs text-zinc-500">
                    {t.fixedModal.emptyList}
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[410px] overflow-y-auto pr-1">
                    {sortedInstances.map((fa) => (
                      <div
                        key={fa.id}
                        className={`p-3 rounded-md border transition-colors ${
                          editingId === fa.id
                            ? 'border-zinc-900 bg-zinc-50'
                            : 'border-zinc-200 bg-white'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-zinc-900 truncate">
                              {fa.title}
                            </div>
                            <div className="text-[11px] text-zinc-500 mt-0.5 tabular-nums">
                              <span className="font-mono text-zinc-800">
                                {formatShortDate(fa.date, language)}
                              </span>{' '}
                              ·{' '}
                              <span className="font-mono text-zinc-700">
                                {formatMinutesToTime(fa.startMinutes)}–
                                {formatMinutesToTime(fa.endMinutes)}
                              </span>{' '}
                              ({formatDuration(fa.endMinutes - fa.startMinutes)})
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => loadForEdit(fa)}
                              title={t.fixedModal.editOccurrenceTitle}
                              aria-label={t.fixedModal.editOccurrenceTitle}
                              className="p-1 text-zinc-400 hover:text-zinc-900 rounded"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                deleteFixedActivity(fa.id);
                                if (editingId === fa.id) resetForm();
                              }}
                              title={t.fixedModal.deleteOccurrenceTitle}
                              aria-label={t.fixedModal.deleteOccurrenceTitle}
                              className="p-1 text-zinc-400 hover:text-red-600 rounded"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="mt-2 pt-2 border-t border-zinc-100 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-500 tabular-nums">
                          <span>{t.fixedModal.kinds[fa.kind]}</span>
                          <span className="text-zinc-300" aria-hidden="true">/</span>
                          <span
                            className={
                              fa.countsAsWorkingTime
                                ? 'text-zinc-800 font-medium'
                                : 'text-zinc-400'
                            }
                          >
                            {fa.countsAsWorkingTime ? t.fixedModal.workingTag : t.fixedModal.breakTag}
                          </span>
                          <span className="text-zinc-300" aria-hidden="true">/</span>
                          <span className="font-mono">{fa.valueCategory}</span>
                          {fa.linkedStepIds.length > 0 && (
                            <>
                              <span className="text-zinc-300" aria-hidden="true">/</span>
                              <span className="text-zinc-700 font-medium">
                                {t.fixedModal.linkedStepsCount(fa.linkedStepIds.length)}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="max-w-lg space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900 flex items-center gap-2">
                  <CalendarClock className="w-4 h-4 text-zinc-700" />
                  {t.fixedModal.windowTitle}
                </h3>
                <p className="text-xs text-zinc-500 mt-1">
                  {t.fixedModal.windowDesc}
                </p>
              </div>

              <div>
                <span className="block text-xs font-medium text-zinc-700 mb-2">
                  {t.fixedModal.workingDaysLabel}
                </span>
                <div className="grid grid-cols-7 gap-1.5">
                  {SAT_TO_FRI_DAY_NUMS.map((dayNum, idx) => {
                    const active = workCapacity.workdays.includes(dayNum);
                    return (
                      <button
                        key={dayNum}
                        type="button"
                        onClick={() => toggleWorkday(dayNum)}
                        className={`py-2 text-xs font-medium rounded border transition-colors ${
                          active
                            ? 'bg-zinc-900 text-white border-zinc-900'
                            : 'bg-white text-zinc-600 border-zinc-300 hover:border-zinc-500'
                        }`}
                      >
                        {t.fixedModal.daysSatToFri[idx]}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="cap-start" className="block text-xs font-medium text-zinc-700 mb-1">
                    {t.fixedModal.workdayStartLabel}
                  </label>
                  <select
                    id="cap-start"
                    value={workCapacity.workdayStartMinutes}
                    onChange={(e) =>
                      updateWorkCapacity({ workdayStartMinutes: Number(e.target.value) })
                    }
                    className="w-full px-2.5 py-2 text-xs font-mono tabular-nums text-zinc-900 bg-white border border-zinc-300 rounded-md"
                  >
                    {TIME_SLOTS.slice(0, -2).map((m) => (
                      <option key={m} value={m}>
                        {formatMinutesToTime(m)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="cap-end" className="block text-xs font-medium text-zinc-700 mb-1">
                    {t.fixedModal.workdayEndLabel}
                  </label>
                  <select
                    id="cap-end"
                    value={workCapacity.workdayEndMinutes}
                    onChange={(e) =>
                      updateWorkCapacity({ workdayEndMinutes: Number(e.target.value) })
                    }
                    className="w-full px-2.5 py-2 text-xs font-mono tabular-nums text-zinc-900 bg-white border border-zinc-300 rounded-md"
                  >
                    {TIME_SLOTS.filter((m) => m > workCapacity.workdayStartMinutes).map((m) => (
                      <option key={m} value={m}>
                        {formatMinutesToTime(m)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="cap-target" className="block text-xs font-medium text-zinc-700 mb-1">
                    {t.fixedModal.dailyPeakLabel}
                  </label>
                  <input
                    id="cap-target"
                    type="number"
                    min={1}
                    max={14}
                    step={0.5}
                    value={workCapacity.dailyTargetHours}
                    onChange={(e) =>
                      updateWorkCapacity({
                        dailyTargetHours: Math.max(1, Math.min(14, Number(e.target.value) || 8)),
                      })
                    }
                    className="w-full px-2.5 py-2 text-xs font-mono tabular-nums text-zinc-900 bg-white border border-zinc-300 rounded-md"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
