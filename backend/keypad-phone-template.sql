-- ===================================================================
--  Keypad Phone spec template
-- ===================================================================
--  Adds ONLY this template. It does NOT touch your existing templates,
--  which is why this is safer than the admin "Seed presets" button —
--  that button re-posts every preset and would overwrite the custom
--  options you have added to the Mobile Phone template.
--
--  Safe to re-run: re-running refreshes this one template in place.
--
--    sudo -u postgres psql -d zmobilepkdb -f keypad-phone-template.sql
-- ===================================================================

INSERT INTO spec_template (id, name, handle, description, icon, is_preset, sort_order, template_data, created_at, updated_at)
VALUES (
  'sptpl_keypad_phone',
  'Keypad Phone',
  'keypad-phone',
  'Feature/button phones — SIM slots, network, battery life, torch, FM radio.',
  'ph-device-mobile',
  true,
  1,
  '{"groups":[{"name":"Overview & Status","icon":"ph-device-mobile","fields":[{"key":"release_date","label":"Release Date","type":"text","highlight":true,"placeholder":"e.g. March 2026"},{"key":"price_rs","label":"Price in Rs","type":"text","highlight":true,"placeholder":"Calculated automatically"},{"key":"pta_approved","label":"PTA Approved","type":"boolean","highlight":true,"is_filter":true},{"key":"form_factor","label":"Design","type":"select","options":["Bar / Candybar","Flip","Slider"],"is_filter":true,"placeholder":"Bar / Candybar"},{"key":"network","label":"Network","type":"select","options":["2G only","3G","4G LTE","4G VoLTE"],"highlight":true,"is_filter":true,"placeholder":"e.g. 4G VoLTE"},{"key":"sim_slots","label":"SIM Slots","type":"select","options":["Single SIM","Dual SIM","Triple SIM","Quad SIM"],"highlight":true,"is_filter":true,"placeholder":"Dual SIM"},{"key":"colors","label":"Colors","type":"select","options":["Black","Blue","Red","Grey","Gold","Silver"],"placeholder":"Black, Blue, Red"}]},{"name":"Display","icon":"ph-monitor","fields":[{"key":"display_size","label":"Display Size","type":"select","options":["1.77 inches","1.8 inches","2.4 inches","2.8 inches","3.2 inches"],"highlight":true,"placeholder":"2.4 inches"},{"key":"display_technology","label":"Panel Technology","type":"select","options":["TFT","TFT LCD","CSTN","IPS LCD"],"placeholder":"TFT LCD"},{"key":"display_resolution","label":"Resolution","type":"text","placeholder":"e.g. 240 x 320 pixels"}]},{"name":"Keypad & Usability","icon":"ph-keyboard","fields":[{"key":"keypad_type","label":"Keypad Type","type":"select","options":["Alphanumeric (T9)","Numeric","QWERTY"],"placeholder":"Alphanumeric (T9)"},{"key":"big_font_keys","label":"Big Font & Keys","type":"boolean"},{"key":"torch","label":"Torch / Flashlight","type":"boolean","highlight":true,"is_filter":true},{"key":"languages","label":"Languages","type":"text","placeholder":"e.g. English, Urdu"}]},{"name":"Battery & Power","icon":"ph-battery-full","fields":[{"key":"battery_capacity","label":"Battery Capacity","type":"select","options":["1000 mAh","1200 mAh","1450 mAh","1800 mAh","2500 mAh","3000 mAh"],"highlight":true,"is_filter":true,"placeholder":"1800 mAh"},{"key":"battery_removable","label":"Removable Battery","type":"boolean","highlight":true},{"key":"standby_time","label":"Standby Time","type":"text","placeholder":"e.g. Up to 15 days"},{"key":"talk_time","label":"Talk Time","type":"text","placeholder":"e.g. Up to 8 hours"},{"key":"charging_port","label":"Charging Port","type":"select","options":["Micro-USB","USB Type-C","Pin Charger"],"placeholder":"Micro-USB"}]},{"name":"Camera & Multimedia","icon":"ph-camera","fields":[{"key":"camera_main","label":"Camera","type":"select","options":["No Camera","VGA (0.3MP)","1.3MP","2MP","5MP"],"placeholder":"VGA (0.3MP)"},{"key":"fm_radio","label":"FM Radio","type":"boolean","highlight":true,"is_filter":true},{"key":"wireless_fm","label":"Wireless FM (no earphones)","type":"boolean"},{"key":"mp3_player","label":"MP3 / Video Player","type":"boolean"},{"key":"3_5mm_headphone_jack","label":"3.5mm Headphone Jack","type":"boolean"}]},{"name":"Memory & Connectivity","icon":"ph-database","fields":[{"key":"memory","label":"RAM","type":"select","options":["4 MB","8 MB","32 MB","64 MB","128 MB"],"placeholder":"32 MB"},{"key":"storage","label":"Storage","type":"select","options":["4 MB","32 MB","64 MB","128 MB"],"placeholder":"64 MB"},{"key":"expandable_storage","label":"Card Slot","type":"text","placeholder":"microSD, up to 32GB"},{"key":"bluetooth","label":"Bluetooth","type":"boolean"},{"key":"whatsapp_support","label":"WhatsApp Support","type":"boolean","is_filter":true},{"key":"call_recording","label":"Auto Call Recording","type":"boolean"}]},{"name":"Build","icon":"ph-ruler","fields":[{"key":"weight","label":"Weight","type":"text","placeholder":"e.g. 78 g"},{"key":"dimensions","label":"Dimensions","type":"text","placeholder":"e.g. 132 x 56 x 13 mm"}]}]}'::jsonb,
  now(), now()
)
-- `handle` is covered by a PARTIAL unique index
-- ("IDX_spec_template_handle_unique" ... WHERE deleted_at IS NULL), so the
-- conflict target must repeat that predicate or Postgres won't match it.
ON CONFLICT (handle) WHERE deleted_at IS NULL DO UPDATE
  SET name          = EXCLUDED.name,
      description   = EXCLUDED.description,
      icon          = EXCLUDED.icon,
      is_preset     = EXCLUDED.is_preset,
      sort_order    = EXCLUDED.sort_order,
      template_data = EXCLUDED.template_data,
      updated_at    = now();
