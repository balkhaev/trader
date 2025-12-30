"use client";

import { Calendar, ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface KeyDate {
  date: Date;
  eventCount: number;
  description: string;
}

interface TimeSliderProps {
  startDate?: Date;
  endDate?: Date;
  currentDate: Date;
  keyDates?: KeyDate[];
  onDateChange: (date: Date) => void;
  loading?: boolean;
}

export function TimeSlider({
  startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
  endDate = new Date(),
  currentDate,
  keyDates = [],
  onDateChange,
  loading,
}: TimeSliderProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(1000); // ms per step

  // Calculate slider value (0-100)
  const totalMs = endDate.getTime() - startDate.getTime();
  const currentMs = currentDate.getTime() - startDate.getTime();
  const sliderValue = totalMs > 0 ? (currentMs / totalMs) * 100 : 0;

  // Handle slider change
  const handleSliderChange = useCallback(
    (value: number[]) => {
      const newMs = (value[0] / 100) * totalMs;
      const newDate = new Date(startDate.getTime() + newMs);
      onDateChange(newDate);
    },
    [startDate, totalMs, onDateChange]
  );

  // Step forward/backward
  const step = useCallback(
    (direction: 1 | -1) => {
      const stepMs = 24 * 60 * 60 * 1000; // 1 day
      const newDate = new Date(currentDate.getTime() + direction * stepMs);

      if (newDate >= startDate && newDate <= endDate) {
        onDateChange(newDate);
      }
    },
    [currentDate, startDate, endDate, onDateChange]
  );

  // Jump to key date
  const jumpToKeyDate = useCallback(
    (date: Date) => {
      onDateChange(date);
    },
    [onDateChange]
  );

  // Auto-play
  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      const stepMs = 24 * 60 * 60 * 1000; // 1 day
      const newDate = new Date(currentDate.getTime() + stepMs);

      if (newDate >= endDate) {
        setIsPlaying(false);
        onDateChange(endDate);
      } else {
        onDateChange(newDate);
      }
    }, playSpeed);

    return () => clearInterval(interval);
  }, [isPlaying, currentDate, endDate, playSpeed, onDateChange]);

  // Calculate key date positions on slider
  const getKeyDatePosition = (date: Date): number => {
    const ms = date.getTime() - startDate.getTime();
    return (ms / totalMs) * 100;
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-4 backdrop-blur">
      <div className="flex items-center justify-between">
        {/* Current date display */}
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-amber-500" />
          <span className="font-mono text-sm text-zinc-100">
            {currentDate.toLocaleDateString("en-US", {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </span>
          {loading && (
            <Badge className="text-xs text-zinc-500" variant="outline">
              Loading...
            </Badge>
          )}
        </div>

        {/* Playback controls */}
        <div className="flex items-center gap-1">
          <Button
            className="h-8 w-8 text-zinc-400 hover:text-zinc-100"
            disabled={currentDate <= startDate}
            onClick={() => step(-1)}
            size="icon"
            variant="ghost"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            className={`h-8 w-8 ${isPlaying ? "text-amber-500" : "text-zinc-400"} hover:text-zinc-100`}
            onClick={() => setIsPlaying(!isPlaying)}
            size="icon"
            variant="ghost"
          >
            {isPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </Button>
          <Button
            className="h-8 w-8 text-zinc-400 hover:text-zinc-100"
            disabled={currentDate >= endDate}
            onClick={() => step(1)}
            size="icon"
            variant="ghost"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Date range */}
        <div className="font-mono text-xs text-zinc-500">
          {startDate.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
          {" - "}
          {endDate.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </div>
      </div>

      {/* Slider with key dates */}
      <div className="relative mt-4">
        <Slider
          className="w-full"
          max={100}
          min={0}
          onValueChange={handleSliderChange}
          step={0.1}
          value={[sliderValue]}
        />

        {/* Key date markers */}
        <TooltipProvider>
          <div className="pointer-events-none absolute -top-1 right-0 left-0">
            {keyDates.map((keyDate, i) => {
              const pos = getKeyDatePosition(keyDate.date);
              return (
                <Tooltip key={i}>
                  <TooltipTrigger asChild>
                    <button
                      className="pointer-events-auto absolute -translate-x-1/2 transform"
                      onClick={() => jumpToKeyDate(keyDate.date)}
                      style={{ left: `${pos}%` }}
                    >
                      <div className="h-4 w-1 rounded-full bg-amber-500 hover:bg-amber-400" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    className="border-zinc-700 bg-zinc-900"
                    side="top"
                  >
                    <div className="text-xs">
                      <div className="font-medium text-zinc-100">
                        {keyDate.date.toLocaleDateString()}
                      </div>
                      <div className="text-zinc-400">{keyDate.description}</div>
                      <div className="text-amber-500">
                        {keyDate.eventCount} events
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </TooltipProvider>
      </div>

      {/* Speed control */}
      <div className="mt-3 flex items-center justify-between text-xs">
        <span className="text-zinc-500">Playback speed:</span>
        <div className="flex gap-1">
          {[2000, 1000, 500, 250].map((speed) => (
            <Button
              className={`h-6 px-2 text-xs ${
                playSpeed === speed
                  ? "bg-amber-500/20 text-amber-400"
                  : "text-zinc-500"
              }`}
              key={speed}
              onClick={() => setPlaySpeed(speed)}
              size="sm"
              variant="ghost"
            >
              {speed === 2000
                ? "0.5x"
                : speed === 1000
                  ? "1x"
                  : speed === 500
                    ? "2x"
                    : "4x"}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
