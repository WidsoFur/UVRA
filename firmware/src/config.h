#pragma once

// ===== ВЫБОР ПЛАТЫ =====
// Раскомментируйте одну из строк:
#define BOARD_ESP32
// #define BOARD_ESP32_S3

// ===== НАСТРОЙКИ WiFi =====
#define WIFI_SSID     "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// ===== НАСТРОЙКИ UVRA =====
// Порт для отправки данных (должен совпадать с портом в приложении UVRA)
#define UVRA_DATA_PORT     7777
// Порт для автообнаружения (discovery)
#define UVRA_DISCOVERY_PORT 7776
// Интервал отправки discovery-запросов (мс)
#define DISCOVERY_INTERVAL  2000
// Рука: "left" или "right"
#define HAND               "left"

// ===== ПИНЫ ДАТЧИКОВ =====
// Если нужны кастомные пины — задайте их здесь, они перезапишут дефолты ниже.
// Например:
// #define FLEX_THUMB_PIN  4

// --- Дефолтные пины для каждой платы ---
#if defined(BOARD_ESP32)
  // ESP32 classic: ADC1 каналы на GPIO 32-39
  #ifndef FLEX_THUMB_PIN
    #define FLEX_THUMB_PIN   36
  #endif
  #ifndef FLEX_INDEX_PIN
    #define FLEX_INDEX_PIN   39
  #endif
  #ifndef FLEX_MIDDLE_PIN
    #define FLEX_MIDDLE_PIN  34
  #endif
  #ifndef FLEX_RING_PIN
    #define FLEX_RING_PIN    35
  #endif
  #ifndef FLEX_PINKY_PIN
    #define FLEX_PINKY_PIN   32
  #endif

  #ifndef JOY_X_PIN
    #define JOY_X_PIN        33
  #endif
  #ifndef JOY_Y_PIN
    #define JOY_Y_PIN        25
  #endif
  #ifndef JOY_BTN_PIN
    #define JOY_BTN_PIN      26
  #endif

  #ifndef BTN_A_PIN
    #define BTN_A_PIN        27
  #endif
  #ifndef BTN_B_PIN
    #define BTN_B_PIN        14
  #endif
  #ifndef TRIGGER_PIN
    #define TRIGGER_PIN      12
  #endif

#elif defined(BOARD_ESP32_S3)
  // ESP32-S3: ADC1 каналы на GPIO 1-10, ADC2 на GPIO 11-20
  #ifndef FLEX_THUMB_PIN
    #define FLEX_THUMB_PIN   1
  #endif
  #ifndef FLEX_INDEX_PIN
    #define FLEX_INDEX_PIN   2
  #endif
  #ifndef FLEX_MIDDLE_PIN
    #define FLEX_MIDDLE_PIN  3
  #endif
  #ifndef FLEX_RING_PIN
    #define FLEX_RING_PIN    4
  #endif
  #ifndef FLEX_PINKY_PIN
    #define FLEX_PINKY_PIN   5
  #endif

  #ifndef JOY_X_PIN
    #define JOY_X_PIN        6
  #endif
  #ifndef JOY_Y_PIN
    #define JOY_Y_PIN        7
  #endif
  #ifndef JOY_BTN_PIN
    #define JOY_BTN_PIN      15
  #endif

  #ifndef BTN_A_PIN
    #define BTN_A_PIN        16
  #endif
  #ifndef BTN_B_PIN
    #define BTN_B_PIN        17
  #endif
  #ifndef TRIGGER_PIN
    #define TRIGGER_PIN      8
  #endif

#else
  #error "Выберите плату: раскомментируйте BOARD_ESP32 или BOARD_ESP32_S3 в config.h"
#endif

// ===== КАЛИБРОВКА =====
// Минимальные значения АЦП для каждого пальца (палец разогнут)
#define FLEX_THUMB_MIN   0
#define FLEX_INDEX_MIN   0
#define FLEX_MIDDLE_MIN  0
#define FLEX_RING_MIN    0
#define FLEX_PINKY_MIN   0

// Максимальные значения АЦП для каждого пальца (палец согнут)
#define FLEX_THUMB_MAX   4095
#define FLEX_INDEX_MAX   4095
#define FLEX_MIDDLE_MAX  4095
#define FLEX_RING_MAX    4095
#define FLEX_PINKY_MAX   4095

// ===== ЧАСТОТА ОТПРАВКИ =====
// Задержка между отправками данных (мс). 10 = ~100 Гц
#define SEND_INTERVAL_MS 10
