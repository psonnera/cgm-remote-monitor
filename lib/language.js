'use strict';

var _ = require('lodash');

function init (fs) {

  function language () {
    return language;
  }

  language.speechCode = 'en-US';
  language.lang = 'en';

  language.languages = [
    { code: 'ar', file: 'ar_SA', language: 'اللغة العربية', speechCode: 'ar-SA' }
    , { code: 'bg', file: 'bg_BG', language: 'Български', speechCode: 'bg-BG' }
    , { code: 'cs', file: 'cs_CZ', language: 'Čeština', speechCode: 'cs-CZ' }
    , { code: 'de', file: 'de_DE', language: 'Deutsch', speechCode: 'de-DE' }
    , { code: 'dk', file: 'da_DK', language: 'Dansk', speechCode: 'dk-DK' }
    , { code: 'el', file: 'el_GR', language: 'Ελληνικά', speechCode: 'el-GR' }
    , { code: 'en', file: 'en_US', language: 'English', speechCode: 'en-US' }
    , { code: 'es', file: 'es_ES', language: 'Español', speechCode: 'es-ES' }
    , { code: 'fi', file: 'fi_FI', language: 'Suomi', speechCode: 'fi-FI' }
    , { code: 'fr', file: 'fr_FR', language: 'Français', speechCode: 'fr-FR' }
    , { code: 'he', file: 'he_IL', language: 'עברית', speechCode: 'he-IL' }
    , { code: 'hr', file: 'hr_HR', language: 'Hrvatski', speechCode: 'hr-HR' }
    , { code: 'hu', file: 'hu_HU', language: 'Magyar', speechCode: 'hu-HU' }
    , { code: 'it', file: 'it_IT', language: 'Italiano', speechCode: 'it-IT' }
    , { code: 'ja', file: 'ja_JP', language: '日本語', speechCode: 'ja-JP' }
    , { code: 'ko', file: 'ko_KR', language: '한국어', speechCode: 'ko-KR' }
    , { code: 'nb', file: 'nb_NO', language: 'Norsk (Bokmål)', speechCode: 'no-NO' }
    , { code: 'nl', file: 'nl_NL', language: 'Nederlands', speechCode: 'nl-NL' }
    , { code: 'pl', file: 'pl_PL', language: 'Polski', speechCode: 'pl-PL' }
    , { code: 'pt', file: 'pt_PT', language: 'Português', speechCode: 'pt-PT' }
    , { code: 'br', file: 'pt_BR', language: 'Português (Brasil)', speechCode: 'pt-BR' }
    , { code: 'ro', file: 'ro_RO', language: 'Română', speechCode: 'ro-RO' }
    , { code: 'ru', file: 'ru_RU', language: 'Русский', speechCode: 'ru-RU' }
    , { code: 'sk', file: 'sk_SK', language: 'Slovenčina', speechCode: 'sk-SK' }
    , { code: 'sl', file: 'sl_SL', language: 'Slovenščina', speechCode: 'sl-SL' }
    , { code: 'sv', file: 'sv_SE', language: 'Svenska', speechCode: 'sv-SE' }
    , { code: 'tr', file: 'tr_TR', language: 'Türkçe', speechCode: 'tr-TR' }
    , { code: 'uk', file: 'uk_UA', language: 'українська', speechCode: 'uk-UA' }
    , { code: 'zh_cn', file: 'zh_CN', language: '中文（简体）', speechCode: 'cmn-Hans-CN' }
//    , { code: 'zh_tw', file: 'zh_TW', language: '中文（繁體）', speechCode: 'cmn-Hant-TW' }
  ];

  var translations = {};
  var reverseTranslationMap = {};

  language.translations = translations;

  language.offerTranslations = function offerTranslations (localization) {
    translations = localization;
    language.translations = translations;
  }

  // Build a reverse translation map for specific keys from all language files
  // This allows normalizing incoming translated values (e.g., from AAPS) back to English
  language.buildReverseTranslationMap = function buildReverseTranslationMap (fs, path, keys) {
    reverseTranslationMap = {};
    
    // Add English keys mapping to themselves
    keys.forEach(function(key) {
      reverseTranslationMap[key.toLowerCase()] = key;
    });
    
    // Load each language file and build reverse mappings
    language.languages.forEach(function(lang) {
      try {
        var filename = './translations/' + (lang.code === 'en' ? 'en/en.json' : lang.file + '.json');
        if (path) filename = path.resolve(__dirname, filename);
        /* eslint-disable-next-line security/detect-non-literal-fs-filename */
        var content = fs.readFileSync(filename);
        var langTranslations = JSON.parse(content);
        
        keys.forEach(function(key) {
          if (langTranslations[key]) {
            var translatedValue = langTranslations[key].toLowerCase();
            reverseTranslationMap[translatedValue] = key;
          }
        });
      } catch (err) {
        // Skip files that can't be loaded
      }
    });
  }

  // Reverse translate: given a value in any language, return the English key
  language.reverseTranslate = function reverseTranslate (text) {
    if (!text) return text;
    var lookup = reverseTranslationMap[text.toLowerCase()];
    return lookup || text;
  }

  // case sensitive
  language.translateCS = function translateCaseSensitive (text) {
    if (translations[text]) {
      return translations[text];
    }
    // console.log('localization:', text, 'not found');
    return text;
  };

  // case insensitive
  language.translateCI = function translateCaseInsensitive (text) {
    var utext = text.toUpperCase();
    _.forEach(translations, function(ts, key) {
      var ukey = key.toUpperCase();
      if (ukey === utext) {
        text = ts;
      }
    });
    return text;
  };

  language.translate = function translate (text, options) {
    var translated;
    if (options && options.ci) {
      translated = language.translateCI(text);
    } else {
      translated = language.translateCS(text);
    }

    var hasCI = false;
    var hasParams = false;

    if (options) {
      hasCI = Object.prototype.hasOwnProperty.call(options,'ci');
      hasParams = Object.prototype.hasOwnProperty.call(options,'params');
    }

    var keys = hasParams ? options.params : null;

    if (options && !hasCI && !hasParams) {
      keys = [];
      for (var i = 1; i < arguments.length; i++) {
        keys.push(arguments[i]);
      }
    }

    if (options && (hasCI || hasParams) && arguments.length > 2) {
      if (!keys) keys = [];
      for (i = 2; i < arguments.length; i++) {
        keys.push(arguments[i]);
      }
    }

    if (keys) {
      for (i = 0; i < keys.length; i++) {
        /* eslint-disable-next-line no-useless-escape, security/detect-non-literal-regexp */ // validated false positive
        var r = new RegExp('\%' + (i + 1), 'g');
        translated = translated.replace(r, keys[i]);
      }
    }

    return translated;
  };

  language.DOMtranslate = function DOMtranslate ($) {
    // do translation of static text on load
    $('.translate').each(function() {
      $(this).text(language.translate($(this).text()));
    });
    $('.titletranslate, .tip').each(function() {
      $(this).attr('title', language.translate($(this).attr('title')));
      $(this).attr('original-title', language.translate($(this).attr('original-title')));
      $(this).attr('placeholder', language.translate($(this).attr('placeholder')));
    });
  };

  language.getFilename = function getFilename (code) {

    if (code == 'en') {
      return 'en/en.json';
    }

    let file;
    language.languages.forEach(function(l) {
      if (l.code == code) file = l.file;
    });
    
    if (!file) {
      console.warn('Language code "' + code + '" not found. Falling back to English.');
      return 'en/en.json';
    }
    
    return file + '.json';
  }

  // this is a server only call and needs fs by reference as the class is also used in the client
  language.loadLocalization = function loadLocalization (fs, path) {
    let filename = './translations/' + this.getFilename(this.lang);
    if (path) filename = path.resolve(__dirname, filename);
    
    try {
      /* eslint-disable-next-line security/detect-non-literal-fs-filename */ // verified false positive; well defined set of values
      const l = fs.readFileSync(filename);
      this.offerTranslations(JSON.parse(l));
    } catch (err) {
      console.error('Error loading language file "' + filename + '": ' + err.message);
      console.warn('Falling back to English translations.');
      // Try to load English as fallback
      if (this.lang !== 'en') {
        this.lang = 'en';
        try {
          filename = './translations/en/en.json';
          if (path) filename = path.resolve(__dirname, filename);
          /* eslint-disable-next-line security/detect-non-literal-fs-filename */
          const l = fs.readFileSync(filename);
          this.offerTranslations(JSON.parse(l));
        } catch (fallbackErr) {
          console.error('Error loading English fallback: ' + fallbackErr.message);
          // Use empty translations object to prevent crashes
          this.offerTranslations({});
        }
      } else {
        // Already trying to load English, just use empty translations
        this.offerTranslations({});
      }
    }
  }

  language.set = function set (newlang) {
    if (!newlang) return;
    language.lang = newlang;

    language.languages.forEach(function(l) {
      if (l.code === language.lang && l.speechCode) language.speechCode = l.speechCode;
    });

    return language();
  };

  language.get = function get (lang) {
    var r;
    language.languages.forEach(function(l) {
      if (l.code === lang) r = l;
    });
    return r;
  }

  // if run on server and we get a filesystem handle, load english by default
  if (fs) {
    language.set('en');
    language.loadLocalization(fs);
  }

  return language();
}

module.exports = init;
