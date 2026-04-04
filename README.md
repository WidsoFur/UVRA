# UVRA Gloves — Universal VR Application

Десктопное приложение для подключения DIY VR-перчаток к **SteamVR** через драйвер **OpenGloves**.

## Архитектура

```
ESP32 (перчатка) --[WiFi/UDP]--> UVRA Gloves --[Named Pipe]--> OpenGloves Driver --> SteamVR
```

## Возможности

- Приём данных от перчаток по **WiFi (UDP)** в нескольких форматах (JSON, бинарный, строковый)
- Передача данных в **SteamVR** через **OpenGloves Named Pipes v2**
- Визуализация сгибания пальцев в реальном времени
- Отображение состояния джойстика и кнопок
- Поддержка левой и правой перчаток одновременно
- Калибровка и настройки
- Красивый тёмный интерфейс

## Требования

- **Windows 10/11**
- **Node.js 18+**
- **SteamVR** с установленным драйвером **[OpenGloves](https://store.steampowered.com/app/1574050/OpenGloves)**

## Установка и запуск

```bash
npm install
npm run dev
```

## Сборка

```bash
npm run build
```

## Протокол WiFi (UDP)

Перчатка отправляет UDP-пакеты на IP компьютера, порт **7777** (настраивается).

### JSON формат (рекомендуется)

```json
{
  "hand": "left",
  "fingers": {
    "thumb":  [0.0, 0.2, 0.3, 0.0],
    "index":  [0.0, 0.5, 0.6, 0.4],
    "middle": [0.0, 0.7, 0.8, 0.6],
    "ring":   [0.0, 0.3, 0.4, 0.2],
    "pinky":  [0.0, 0.1, 0.2, 0.1]
  },
  "splay": [0.5, 0.5, 0.5, 0.5, 0.5],
  "joystick": { "x": 0.0, "y": 0.0 },
  "buttons": {
    "trigger": false, "A": false, "B": false,
    "grab": false, "pinch": false, "menu": false
  },
  "triggerValue": 0.0
}
```

Значения пальцев: `0.0` = разогнут, `1.0` = полностью согнут.

### Простой строковый формат

```
hand:left,max:4095,A:2048,B:1024,C:512,D:3000,E:100
```

## Прошивка ESP32

Пример прошивки для ESP32 находится в папке `firmware/`.
