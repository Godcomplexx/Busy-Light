#include <Adafruit_NeoPixel.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <Preferences.h>
#include <atomic>

// These UUIDs must match site/app.js. All boards use the same service.
constexpr char deviceName[] = "BusyLight-C6";
constexpr char serviceUuid[] = "7172deda-11a4-42ff-a8a4-aed654cd1902";
constexpr char frontUuid[] = "43812956-2215-4715-ac82-5daf5ef1b5d0";
constexpr char topUuid[] = "ef6ea611-33e1-4eb1-a266-1001767c4f6d";

constexpr int switchPin = D0;
constexpr int pixelCount = 5;
Adafruit_NeoPixel beacon(1, D1, NEO_GRB + NEO_KHZ800);
Adafruit_NeoPixel front(pixelCount, D2, NEO_GRB + NEO_KHZ800);
Preferences preferences;

std::atomic<uint32_t> topColor{0xFF0000};
std::atomic<uint32_t> frontColor{0xFFFFFF};
std::atomic<int32_t> pendingTop{-1};
std::atomic<int32_t> pendingFront{-1};
std::atomic<bool> deviceConnected{false};
bool wasConnected = false;
bool colorsNeedSaving = false;
unsigned long colorsChangedAt = 0;

int lastReading = HIGH;
int stableReading = -1;
unsigned long changedAt = 0;
unsigned long animationStart = 0;

bool parseColor(const String &text, uint32_t &color) {
  if (text.length() != 7 || text[0] != '#') return false;
  uint32_t parsed = 0;
  for (int i = 1; i < 7; ++i) {
    const char ch = text[i];
    int digit;
    if (ch >= '0' && ch <= '9') digit = ch - '0';
    else if (ch >= 'A' && ch <= 'F') digit = ch - 'A' + 10;
    else if (ch >= 'a' && ch <= 'f') digit = ch - 'a' + 10;
    else return false;
    parsed = (parsed << 4) | digit;
  }
  color = parsed;
  return true;
}

String colorText(uint32_t color) {
  char text[8];
  snprintf(text, sizeof(text), "#%06lX", static_cast<unsigned long>(color & 0xFFFFFF));
  return String(text);
}

class ColorCallbacks : public BLECharacteristicCallbacks {
 public:
  explicit ColorCallbacks(bool top) : isTop(top) {}

  void onWrite(BLECharacteristic *characteristic) override {
    const String value = characteristic->getValue();
    uint32_t parsed;
    if (!parseColor(value, parsed)) {
      characteristic->setValue(colorText(isTop ? topColor.load() : frontColor.load()));
      return;
    }
    (isTop ? pendingTop : pendingFront).store(static_cast<int32_t>(parsed));
    characteristic->setValue(colorText(parsed));
  }

 private:
  bool isTop;
};

class ConnectionCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *) override { deviceConnected.store(true); }
  void onDisconnect(BLEServer *) override { deviceConnected.store(false); }
};

void setup() {
  Serial.begin(115200);
  pinMode(switchPin, INPUT_PULLUP);
  beacon.begin();
  front.begin();
  beacon.setBrightness(40);
  front.setBrightness(30);
  beacon.clear();
  front.clear();
  beacon.show();
  front.show();

  preferences.begin("busy_light", false);
  topColor.store(preferences.getUInt("top_rgb", 0xFF0000) & 0xFFFFFF);
  frontColor.store(preferences.getUInt("front_rgb", 0xFFFFFF) & 0xFFFFFF);

  BLEDevice::init(deviceName);
  BLEServer *server = BLEDevice::createServer();
  server->setCallbacks(new ConnectionCallbacks());
  BLEService *service = server->createService(serviceUuid);

  BLECharacteristic *top = service->createCharacteristic(
    topUuid, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE
  );
  top->setCallbacks(new ColorCallbacks(true));
  top->setValue(colorText(topColor.load()));

  BLECharacteristic *frontPixels = service->createCharacteristic(
    frontUuid, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE
  );
  frontPixels->setCallbacks(new ColorCallbacks(false));
  frontPixels->setValue(colorText(frontColor.load()));

  service->start();
  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(serviceUuid);
  advertising->setScanResponse(true);
  BLEDevice::startAdvertising();
  Serial.println("BusyLight-C6 BLE ready");
}

void loop() {
  const unsigned long now = millis();
  const int32_t nextTop = pendingTop.exchange(-1);
  const int32_t nextFront = pendingFront.exchange(-1);
  if (nextTop >= 0) {
    topColor.store(static_cast<uint32_t>(nextTop));
    colorsNeedSaving = true;
    colorsChangedAt = now;
  }
  if (nextFront >= 0) {
    frontColor.store(static_cast<uint32_t>(nextFront));
    colorsNeedSaving = true;
    colorsChangedAt = now;
  }
  if (colorsNeedSaving && now - colorsChangedAt >= 1000) {
    preferences.putUInt("top_rgb", topColor.load());
    preferences.putUInt("front_rgb", frontColor.load());
    colorsNeedSaving = false;
  }

  const bool connected = deviceConnected.load();
  if (!connected && wasConnected) {
    delay(200);
    BLEDevice::startAdvertising();
  }
  wasConnected = connected;

  const int reading = digitalRead(switchPin);
  if (reading != lastReading) {
    lastReading = reading;
    changedAt = now;
  }
  if (now - changedAt >= 40 && reading != stableReading) {
    stableReading = reading;
    animationStart = now;
  }
  if (stableReading < 0) return;

  const uint32_t selectedTop = topColor.load();
  beacon.setPixelColor(0, stableReading == LOW
    ? beacon.Color((selectedTop >> 16) & 0xFF, (selectedTop >> 8) & 0xFF, selectedTop & 0xFF)
    : 0);
  beacon.show();

  const uint32_t selectedFront = frontColor.load();
  const uint32_t frontPixel = front.Color(
    (selectedFront >> 16) & 0xFF, (selectedFront >> 8) & 0xFF, selectedFront & 0xFF
  );
  const int lit = stableReading == HIGH
    ? pixelCount
    : ((now - animationStart) / 260) % (pixelCount + 1);
  front.clear();
  if (lit > 0) front.fill(frontPixel, 0, lit);
  front.show();
  delay(15);
}
