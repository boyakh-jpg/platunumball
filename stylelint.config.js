export default {
  extends: ["stylelint-config-standard"],
  rules: {
    "import-notation": "string",
    "color-no-hex": true,
    "declaration-no-important": true,
    "function-disallowed-list": ["rgb", "rgba", "hsl", "hsla"],
    "declaration-property-value-disallowed-list": {
      "border-radius": ["/^(?!var\\(|0$|50%$|999px$).+/"],
      "box-shadow": ["/^(?!var\\(|none$).+/"],
    },
    "selector-class-pattern": [
      "^ui-[a-z0-9]+(?:-[a-z0-9]+)*$",
      {
        message: "공통 primitive 클래스는 ui-* kebab-case를 사용하세요.",
        resolveNestedSelectors: true,
      },
    ],
  },
};
