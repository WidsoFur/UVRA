#include <Arduino.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <ArduinoJson.h>

// ===== НАСТРОЙКИ WiFi =====
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";

// ===== НАСТРОЙКИ UVRA =====
const char* UVRA_IP   = "192.168.1.100";  // IP компьютера с UVRA
const int   UVRA_PORT = 7777;
const char* HAND      = "left";            // "left" или "right"

// ===== ПИНЫ ДАТЧИКОВ =====
const int FLEX_PINS[5] = {36, 39, 34, 35, 32}; // Thumb, Index, Middle, Ring, Pinky
const int JOY_X_PIN = 33;
const int JOY_Y_PIN = 25;
const int JOY_BTN_PIN = 26;
const int BTN_A_PIN = 27;
const int BTN_B_PIN = 14;
const int TRIGGER_PIN = 12;

// ===== КАЛИБРОВКА =====
int flexMin[5] = {0, 0, 0, 0, 0};
int flexMax[5] = {4095, 4095, 4095, 4095, 4095};

WiFiUDP udp;
StaticJsonDocument<512> doc;

float mapFlex(int raw, int minVal, int maxVal) {
  float val = (float)(raw - minVal) / (float)(maxVal - minVal);
  return constrain(val, 0.0f, 1.0f);
}

void setup() {
  Serial.begin(115200);

  // Настройка пинов
  for (int i = 0; i < 5; i++) {
    pinMode(FLEX_PINS[i], INPUT);
  }
  pinMode(JOY_X_PIN, INPUT);
  pinMode(JOY_Y_PIN, INPUT);
  pinMode(JOY_BTN_PIN, INPUT_PULLUP);
  pinMode(BTN_A_PIN, INPUT_PULLUP);
  pinMode(BTN_B_PIN, INPUT_PULLUP);
  pinMode(TRIGGER_PIN, INPUT);

  // Подключение к WiFi
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("Connected! IP: ");
  Serial.println(WiFi.localIP());

  udp.begin(UVRA_PORT);
}

void loop() {
  // Чтение датчиков сгибания
  float flex[5];
  for (int i = 0; i < 5; i++) {
    int raw = analogRead(FLEX_PINS[i]);
    flex[i] = mapFlex(raw, flexMin[i], flexMax[i]);
  }

  // Чтение джойстика
  float joyX = (analogRead(JOY_X_PIN) - 2048.0f) / 2048.0f;
  float joyY = (analogRead(JOY_Y_PIN) - 2048.0f) / 2048.0f;
  bool joyBtn = !digitalRead(JOY_BTN_PIN);

  // Чтение кнопок
  bool btnA = !digitalRead(BTN_A_PIN);
  bool btnB = !digitalRead(BTN_B_PIN);
  float trigVal = analogRead(TRIGGER_PIN) / 4095.0f;
  bool trigBtn = trigVal > 0.8f;

  // Формирование JSON
  doc.clear();
  doc["hand"] = HAND;

  JsonObject fingers = doc.createNestedObject("fingers");
  const char* fingerNames[] = {"thumb", "index", "middle", "ring", "pinky"};
  for (int i = 0; i < 5; i++) {
    JsonArray arr = fingers.createNestedArray(fingerNames[i]);
    arr.add(0.0f);       // joint 0 (carpometacarpal)
    arr.add(flex[i]);    // joint 1 (metacarpophalangeal)
    arr.add(flex[i]);    // joint 2 (proximal interphalangeal)
    arr.add(i == 0 ? 0.0f : flex[i]); // joint 3 (distal, не для большого)
  }

  JsonArray splay = doc.createNestedArray("splay");
  for (int i = 0; i < 5; i++) splay.add(0.5f);

  JsonObject joy = doc.createNestedObject("joystick");
  joy["x"] = joyX;
  joy["y"] = joyY;

  JsonObject btns = doc.createNestedObject("buttons");
  btns["joy"] = joyBtn;
  btns["trigger"] = trigBtn;
  btns["A"] = btnA;
  btns["B"] = btnB;
  btns["grab"] = flex[1] > 0.7f && flex[2] > 0.7f && flex[3] > 0.7f && flex[4] > 0.7f;
  btns["pinch"] = flex[0] > 0.6f && flex[1] > 0.6f;

  doc["triggerValue"] = trigVal;

  // Отправка UDP
  char buffer[512];
  size_t len = serializeJson(doc, buffer, sizeof(buffer));

  udp.beginPacket(UVRA_IP, UVRA_PORT);
  udp.write((uint8_t*)buffer, len);
  udp.endPacket();

  delay(10); // ~100 Гц
}
