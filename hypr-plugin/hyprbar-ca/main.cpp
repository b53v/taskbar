#include <algorithm>
#include <cmath>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <vector>

#include <GLES3/gl32.h>
#include <drm_fourcc.h>

#include <hyprland/src/config/supplementary/propRefresher/PropRefresher.hpp>
#include <hyprland/src/config/values/ConfigValues.hpp>
#include <hyprland/src/desktop/view/LayerSurface.hpp>
#include <hyprland/src/helpers/math/Math.hpp>
#include <hyprland/src/managers/input/InputManager.hpp>
#include <hyprland/src/output/Monitor.hpp>
#include <hyprland/src/plugins/PluginAPI.hpp>
#include <hyprland/src/render/OpenGL.hpp>
#include <hyprland/src/render/Renderer.hpp>
#include <hyprland/src/render/gl/GLFramebuffer.hpp>
#include <hyprland/src/state/MonitorState.hpp>
#include <hyprutils/utils/ScopeGuard.hpp>

namespace {

    constexpr const char* kBarNamespace = "bar";
    constexpr int         kScissorPadPx = 4;

    bool isPopupNamespace(const std::string& ns) {
        return ns == "system-menu" ||
               ns == "notifications" ||
               ns == "logout-menu" ||
               ns == "osd" ||
               ns == "rofi" ||
               ns == "gtk4-layer-shell";
    }

    constexpr const char* kVertShaderSrc = R"(#version 300 es
out vec2 v_uv;

void main() {
    vec2 pos = vec2((gl_VertexID == 1) ? 3.0 : -1.0,
                    (gl_VertexID == 2) ? 3.0 : -1.0);
    v_uv = pos * 0.5 + 0.5;
    gl_Position = vec4(pos, 0.0, 1.0);
}
)";

    constexpr const char* kFragShaderSrc = R"(#version 300 es
precision highp float;

in vec2 v_uv;
layout(location = 0) out vec4 fragColor;

uniform sampler2D u_tex;
uniform sampler2D u_surfaceTex;
uniform vec2      u_texelSize;
uniform vec2      u_boxMinUV;
uniform vec2      u_boxSizeUV;
uniform vec2      u_boxSizePx;
uniform float     u_strength;
uniform float     u_edgeBoost;
uniform float     u_verticalRatio;
uniform float     u_chromaBoost;
uniform float     u_refract;
uniform float     u_rimPrism;
uniform float     u_dome;
uniform float     u_maxBevelPx;
uniform float     u_panelScale;
uniform int       u_useMask;
uniform float     u_alphaThresh;
uniform float     u_maskStepScale;

const vec2 kProbeDirs[8] = vec2[8](
    vec2( 1.0,        0.0       ),
    vec2(-1.0,        0.0       ),
    vec2( 0.0,        1.0       ),
    vec2( 0.0,       -1.0       ),
    vec2( 0.70710678, 0.70710678),
    vec2(-0.70710678, 0.70710678),
    vec2( 0.70710678,-0.70710678),
    vec2(-0.70710678,-0.70710678)
);

float sampleMaskAlpha(vec2 uv) {
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0)
        return 0.0;
    return texture(u_surfaceTex, uv).a;
}

float probeMaskDirection(vec2 surfUV, vec2 dir, vec2 pxToSurfUV, float maxR, float stepScale) {
    const float baseSteps[4] = float[4](3.0, 8.0, 14.0, 20.0);

    float prevR  = 0.0;
    float lo     = 0.0;
    float hi     = maxR;
    bool  exited = false;

    // Coarse probes at [3, 8, 14, 20] px (stride <= 6px < 8px inter-toast gap),
    // extending in 6px steps up to 48px if max_bevel > 20.
    for (int stepIdx = 0; stepIdx < 9; ++stepIdx) {
        float rawR = (stepIdx < 4)
                         ? (baseSteps[stepIdx] * stepScale)
                         : ((20.0 + float(stepIdx - 3) * 6.0) * stepScale);
        float curR = (maxR < 20.0 * stepScale && stepIdx < 4)
                         ? min(rawR, maxR * (float(stepIdx + 1) * 0.25))
                         : min(rawR, maxR);

        if (curR <= prevR + 0.01) {
            if (curR >= maxR - 0.01)
                break;
            continue;
        }

        if (sampleMaskAlpha(surfUV + dir * (curR * pxToSurfUV)) <= u_alphaThresh) {
            lo     = prevR;
            hi     = curR;
            exited = true;
            break;
        }

        prevR = curR;
        if (curR >= maxR - 0.01)
            break;
    }

    if (!exited)
        return maxR;

    // Binary-search refinement on the exited interval for sub-pixel distance accuracy.
    for (int r = 0; r < 3; ++r) {
        float mid = 0.5 * (lo + hi);
        if (sampleMaskAlpha(surfUV + dir * (mid * pxToSurfUV)) <= u_alphaThresh)
            hi = mid;
        else
            lo = mid;
    }

    return 0.5 * (lo + hi);
}

void main() {
    vec2 surfUV = (v_uv - u_boxMinUV) / max(u_boxSizeUV, vec2(1e-5));
    vec2 local  = clamp(surfUV, 0.0, 1.0);
    vec2 pxSize = max(u_boxSizePx, vec2(1.0));

    vec2  lensNormal = vec2(0.0);
    float edgeFactor = 0.0;
    float flatCore   = 0.0;
    float domeMask   = 1.0;

    if (u_useMask != 0) {
        if (sampleMaskAlpha(surfUV) <= u_alphaThresh) {
            fragColor = texture(u_tex, v_uv);
            return;
        }

        float maxR       = max(min(0.5 * min(pxSize.x, pxSize.y), u_maxBevelPx), 4.0);
        vec2  pxToSurfUV = 1.0 / pxSize;

        float minDist   = maxR;
        vec2  normalSum = vec2(0.0);
        float wSqSum    = 0.0;

        for (int k = 0; k < 8; ++k) {
            vec2  dir = kProbeDirs[k];
            float d   = probeMaskDirection(surfUV, dir, pxToSurfUV, maxR, u_maskStepScale);
            minDist   = min(minDist, d);
            float w   = clamp(1.0 - d / maxR, 0.0, 1.0);
            float w2  = w * w;
            normalSum += dir * w2;
            wSqSum    += w2;
        }

        float rawEdge = clamp(1.0 - minDist / maxR, 0.0, 1.0);
        float nLen    = length(normalSum);
        if (nLen > 1e-5 && rawEdge > 0.0) {
            float balance = clamp(nLen / max(wSqSum * 0.35, 1e-5), 0.0, 1.0);
            edgeFactor    = rawEdge * balance;
            lensNormal    = (normalSum / nLen) * edgeFactor;
        } else {
            edgeFactor = 0.0;
            lensNormal = vec2(0.0);
        }

        flatCore = 1.0;
        domeMask = smoothstep(0.0, 0.35, edgeFactor);
    } else {
        vec2 p = (local - 0.5) * pxSize;

        // Unified capped-bevel capsule / rounded-rectangle lens geometry.
        // Thin pills (bar/osd/fcitx5) have flatCore == 0 -> domeMask == 1.0 (bit-for-bit identical to v2.1.0).
        float radius   = min(0.5 * min(pxSize.x, pxSize.y), u_maxBevelPx);
        vec2  halfCore = max(0.5 * pxSize - vec2(radius), vec2(0.0));
        vec2  spineVec = p - clamp(p, -halfCore, halfCore);
        lensNormal     = spineVec / max(radius, 1.0);
        edgeFactor     = clamp(length(lensNormal), 0.0, 1.0);
        flatCore       = clamp(min(halfCore.x, halfCore.y) / max(radius, 1.0), 0.0, 1.0);
        domeMask       = mix(1.0, smoothstep(0.0, 0.35, edgeFactor), flatCore);
    }

    float pScale       = mix(1.0, u_panelScale, smoothstep(0.5, 1.0, flatCore));
    float effStrength  = u_strength  * pScale;
    float effEdgeBoost = u_edgeBoost * pScale;
    float effDome      = u_dome      * pScale;

    float zDome    = sqrt(max(1.0 - edgeFactor * edgeFactor, 0.0));
    float bevel    = smoothstep(0.18, 1.0, edgeFactor);
    float rimCurve = bevel * bevel;

    vec2 uvMin = 0.5 * u_texelSize;
    vec2 uvMax = 1.0 - uvMin;

    // 1. Convex thick-glass lens refraction (continuous dome magnification + curved perimeter bend).
    float domeWarp  = edgeFactor * (1.0 - 0.35 * edgeFactor * edgeFactor) * (effDome * 3.0);
    vec2  refractUV = clamp(v_uv - lensNormal * (rimCurve * u_refract + domeWarp) * u_texelSize, uvMin, uvMax);

    // 2. Whole-glass continuous optical chromatic dispersion (R/G/B distinct refraction indices).
    // Combines uniform whole-glass horizontal prism axis + convex bevel dispersion.
    float dx = effStrength * (1.0 + 0.35 * bevel) + effEdgeBoost * bevel * (0.45 + 0.55 * abs(lensNormal.x));
    float dy = lensNormal.y * (effStrength * (0.45 + 0.25 * effDome) + effEdgeBoost) * u_verticalRatio;
    vec2  dispUV = vec2(dx, dy) * u_texelSize;

    vec4 centerSample = texture(u_tex, refractUV);
    vec3 base         = centerSample.rgb;

    // Crisp 5-tap optical spectral split (R shifted +, G centered, B shifted -).
    // Channel weights sum strictly to 1.0 -> exact zero tint on uniform areas.
    vec3 sR2 = texture(u_tex, clamp(refractUV + dispUV * 1.00, uvMin, uvMax)).rgb;
    vec3 sR1 = texture(u_tex, clamp(refractUV + dispUV * 0.50, uvMin, uvMax)).rgb;
    vec3 sB1 = texture(u_tex, clamp(refractUV - dispUV * 0.50, uvMin, uvMax)).rgb;
    vec3 sB2 = texture(u_tex, clamp(refractUV - dispUV * 1.00, uvMin, uvMax)).rgb;

    float rChan = sR2.r * 0.68 + sR1.r * 0.27 + base.r * 0.05;
    float gChan = sR1.g * 0.12 + base.g * 0.76 + sB1.g * 0.12;
    float bChan = base.b * 0.05 + sB1.b * 0.27 + sB2.b * 0.68;

    vec3 disp = vec3(rChan, gChan, bChan);

    // Amplify ONLY the true physical dispersion delta (caDelta = disp - base) to compensate
    // for Hyprland's Kawase pre-blur attenuation without re-blurring or tinting flat regions.
    vec3 caDelta = disp - base;
    vec3 color   = base + caDelta * u_chromaBoost;

    // 3. Delicate Fresnel prismatic glass dispersion along the curved meniscus + subtle whole-glass caustic.
    // Modulated by live local wallpaper luminance & brightness gradient so it feels like real light
    // refracting inside thick glass rather than a painted rainbow.
    float lum     = dot(base, vec3(0.299, 0.587, 0.114));
    float lumR    = dot(sR2,  vec3(0.299, 0.587, 0.114));
    float lumB    = dot(sB2,  vec3(0.299, 0.587, 0.114));
    float gradDir = clamp((lumR - lumB) * 3.2, -1.0, 1.0);

    // Optical crown-glass dispersion pair: cool cyan-sapphire <-> warm rose-amber (zero mean tint).
    vec3 coolPrism = vec3(-0.32,  0.14,  0.48);
    vec3 warmPrism = vec3( 0.44,  0.04, -0.34);

    // Whole-glass subtle spectral dispersion following live backdrop luminance gradient + gentle horizontal phase.
    float bodyPhase = gradDir * 0.75 + sin(local.x * 6.2831853 + lum * 3.1415926) * 0.25;
    vec3  bodyPrism = mix(coolPrism, warmPrism, bodyPhase * 0.5 + 0.5) * (0.14 + 0.36 * abs(gradDir));

    // Curved meniscus Fresnel dispersion (peaks softly at outer 2-5px curved glass lip).
    float fresnel  = smoothstep(0.42, 0.98, edgeFactor);
    float rimSide  = clamp(lensNormal.y * 0.78 + lensNormal.x * 0.38, -1.0, 1.0);
    vec3  rimColor = mix(coolPrism, warmPrism, rimSide * 0.5 + 0.5);

    float lightEnergy = 0.28 + 0.72 * sqrt(clamp(lum, 0.0, 1.0));
    color += (bodyPrism * 0.34 + rimColor * (fresnel * fresnel) * 0.85) * u_rimPrism * lightEnergy;

    // 4. Subtle 3D convex dome volume (soft upper specular crest, gentle belly depth,
    //    lower internal caustic bounce, and tactile grazing edge tuck).
    if (effDome > 0.0001) {
        float upperSpec    = exp(-pow((lensNormal.y + 0.52) / 0.34, 2.0)) * (0.55 + 0.45 * zDome) * domeMask;
        float bellyShade   = exp(-pow((lensNormal.y - 0.36) / 0.38, 2.0)) * (0.45 + 0.55 * zDome) * domeMask;
        float lowerCaustic = smoothstep(0.50, 0.92, lensNormal.y) * (1.0 - smoothstep(0.92, 1.0, edgeFactor));
        float capRim       = smoothstep(0.55, 0.90, abs(lensNormal.x)) * (1.0 - smoothstep(0.90, 1.0, edgeFactor)) * 0.45;
        float outerTuck    = smoothstep(0.86, 1.00, edgeFactor);

        float domeEnergy = 0.55 + 0.45 * lum;
        color += vec3(0.96, 0.99, 1.00) * (upperSpec * 0.085 * effDome * domeEnergy);
        color -= vec3(0.060) * (bellyShade * effDome * domeEnergy);
        color += (vec3(1.00, 0.97, 0.94) * 0.070 + warmPrism * 0.040) * ((lowerCaustic + capRim) * effDome * lightEnergy);
        color -= vec3(0.050) * (outerTuck * effDome);
    }

    fragColor = vec4(clamp(color, 0.0, 1.0), centerSample.a);
}
)";

    using origRenderTexWithBlur_t = void (*)(
        Render::GL::CHyprOpenGLImpl*,
        SP<Render::ITexture>,
        const CBox&,
        const Render::GL::CHyprOpenGLImpl::STextureRenderData&
    );

    HANDLE                             g_handle           = nullptr;
    CFunctionHook*                     g_pBlurHook        = nullptr;
    SP<Render::IFramebuffer>           g_caFB             = nullptr;
    DRMFormat                          g_lastReqFormat    = DRM_FORMAT_INVALID;
    GLuint                             g_program          = 0;
    GLuint                             g_vao              = 0;
    bool                               g_inHook           = false;

    GLint                              g_uTex             = -1;
    GLint                              g_uSurfaceTex      = -1;
    GLint                              g_uTexelSize       = -1;
    GLint                              g_uBoxMinUV        = -1;
    GLint                              g_uBoxSizeUV       = -1;
    GLint                              g_uBoxSizePx       = -1;
    GLint                              g_uStrength        = -1;
    GLint                              g_uEdgeBoost       = -1;
    GLint                              g_uVerticalRatio   = -1;
    GLint                              g_uChromaBoost     = -1;
    GLint                              g_uRefract         = -1;
    GLint                              g_uRimPrism        = -1;
    GLint                              g_uDome            = -1;
    GLint                              g_uMaxBevelPx      = -1;
    GLint                              g_uPanelScale      = -1;
    GLint                              g_uUseMask         = -1;
    GLint                              g_uAlphaThresh     = -1;
    GLint                              g_uMaskStepScale   = -1;

    SP<Config::Values::CBoolValue>     g_cfgEnabled       = nullptr;
    SP<Config::Values::CBoolValue>     g_cfgPopups        = nullptr;
    SP<Config::Values::CBoolValue>     g_cfgInputMethods  = nullptr;
    SP<Config::Values::CFloatValue>    g_cfgStrength      = nullptr;
    SP<Config::Values::CFloatValue>    g_cfgEdgeBoost     = nullptr;
    SP<Config::Values::CFloatValue>    g_cfgVerticalRatio = nullptr;
    SP<Config::Values::CFloatValue>    g_cfgChromaBoost   = nullptr;
    SP<Config::Values::CFloatValue>    g_cfgRefract       = nullptr;
    SP<Config::Values::CFloatValue>    g_cfgRimPrism      = nullptr;
    SP<Config::Values::CFloatValue>    g_cfgDome          = nullptr;
    SP<Config::Values::CFloatValue>    g_cfgMaxBevel      = nullptr;
    SP<Config::Values::CFloatValue>    g_cfgPanelScale    = nullptr;

    void damageAllMonitors() {
        if (!g_pHyprRenderer || !State::monitorState())
            return;

        for (const auto& mon : State::monitorState()->monitors()) {
            if (mon)
                g_pHyprRenderer->damageMonitor(mon);
        }
    }

    GLuint compileShader(GLenum type, const char* src, std::string& errOut) {
        GLuint shader = glCreateShader(type);
        if (shader == 0) {
            errOut = "glCreateShader returned 0";
            return 0;
        }

        glShaderSource(shader, 1, &src, nullptr);
        glCompileShader(shader);

        GLint compiled = GL_FALSE;
        glGetShaderiv(shader, GL_COMPILE_STATUS, &compiled);
        if (compiled != GL_TRUE) {
            GLint logLen = 0;
            glGetShaderiv(shader, GL_INFO_LOG_LENGTH, &logLen);
            std::string log(static_cast<size_t>(std::max(logLen, 1)), '\0');
            if (logLen > 1)
                glGetShaderInfoLog(shader, logLen, nullptr, log.data());
            errOut = log;
            glDeleteShader(shader);
            return 0;
        }

        return shader;
    }

    void destroyGLResources() {
        if (Render::GL::g_pHyprOpenGL)
            Render::GL::g_pHyprOpenGL->makeEGLCurrent();

        if (g_caFB) {
            g_caFB->release();
            g_caFB.reset();
        }
        g_lastReqFormat = DRM_FORMAT_INVALID;
        if (g_vao != 0) {
            glDeleteVertexArrays(1, &g_vao);
            g_vao = 0;
        }
        if (g_program != 0) {
            glDeleteProgram(g_program);
            g_program = 0;
        }

        g_uTex           = -1;
        g_uSurfaceTex    = -1;
        g_uTexelSize     = -1;
        g_uBoxMinUV      = -1;
        g_uBoxSizeUV     = -1;
        g_uBoxSizePx     = -1;
        g_uStrength      = -1;
        g_uEdgeBoost     = -1;
        g_uVerticalRatio = -1;
        g_uChromaBoost   = -1;
        g_uRefract       = -1;
        g_uRimPrism      = -1;
        g_uDome          = -1;
        g_uMaxBevelPx    = -1;
        g_uPanelScale    = -1;
        g_uUseMask       = -1;
        g_uAlphaThresh   = -1;
        g_uMaskStepScale = -1;
    }

    void initGLResources() {
        if (!Render::GL::g_pHyprOpenGL)
            throw std::runtime_error("[hyprbar-ca] g_pHyprOpenGL is null");

        Render::GL::g_pHyprOpenGL->makeEGLCurrent();

        std::string err;
        GLuint      vs = compileShader(GL_VERTEX_SHADER, kVertShaderSrc, err);
        if (vs == 0)
            throw std::runtime_error("[hyprbar-ca] vertex shader compile failed: " + err);

        GLuint fs = compileShader(GL_FRAGMENT_SHADER, kFragShaderSrc, err);
        if (fs == 0) {
            glDeleteShader(vs);
            throw std::runtime_error("[hyprbar-ca] fragment shader compile failed: " + err);
        }

        GLuint prog = glCreateProgram();
        if (prog == 0) {
            glDeleteShader(vs);
            glDeleteShader(fs);
            throw std::runtime_error("[hyprbar-ca] glCreateProgram returned 0");
        }

        glAttachShader(prog, vs);
        glAttachShader(prog, fs);
        glLinkProgram(prog);
        glDetachShader(prog, vs);
        glDetachShader(prog, fs);
        glDeleteShader(vs);
        glDeleteShader(fs);

        GLint linked = GL_FALSE;
        glGetProgramiv(prog, GL_LINK_STATUS, &linked);
        if (linked != GL_TRUE) {
            GLint logLen = 0;
            glGetProgramiv(prog, GL_INFO_LOG_LENGTH, &logLen);
            std::string log(static_cast<size_t>(std::max(logLen, 1)), '\0');
            if (logLen > 1)
                glGetProgramInfoLog(prog, logLen, nullptr, log.data());
            glDeleteProgram(prog);
            throw std::runtime_error("[hyprbar-ca] shader link failed: " + log);
        }

        GLuint vao = 0;
        glGenVertexArrays(1, &vao);
        if (vao == 0) {
            glDeleteProgram(prog);
            throw std::runtime_error("[hyprbar-ca] glGenVertexArrays returned 0");
        }

        g_program        = prog;
        g_vao            = vao;
        g_uTex           = glGetUniformLocation(g_program, "u_tex");
        g_uSurfaceTex    = glGetUniformLocation(g_program, "u_surfaceTex");
        g_uTexelSize     = glGetUniformLocation(g_program, "u_texelSize");
        g_uBoxMinUV      = glGetUniformLocation(g_program, "u_boxMinUV");
        g_uBoxSizeUV     = glGetUniformLocation(g_program, "u_boxSizeUV");
        g_uBoxSizePx     = glGetUniformLocation(g_program, "u_boxSizePx");
        g_uStrength      = glGetUniformLocation(g_program, "u_strength");
        g_uEdgeBoost     = glGetUniformLocation(g_program, "u_edgeBoost");
        g_uVerticalRatio = glGetUniformLocation(g_program, "u_verticalRatio");
        g_uChromaBoost   = glGetUniformLocation(g_program, "u_chromaBoost");
        g_uRefract       = glGetUniformLocation(g_program, "u_refract");
        g_uRimPrism      = glGetUniformLocation(g_program, "u_rimPrism");
        g_uDome          = glGetUniformLocation(g_program, "u_dome");
        g_uMaxBevelPx    = glGetUniformLocation(g_program, "u_maxBevelPx");
        g_uPanelScale    = glGetUniformLocation(g_program, "u_panelScale");
        g_uUseMask       = glGetUniformLocation(g_program, "u_useMask");
        g_uAlphaThresh   = glGetUniformLocation(g_program, "u_alphaThresh");
        g_uMaskStepScale = glGetUniformLocation(g_program, "u_maskStepScale");

        if (g_uTex < 0) {
            destroyGLResources();
            throw std::runtime_error("[hyprbar-ca] required uniform u_tex missing");
        }
    }

    bool ensureCAFramebuffer(int w, int h, DRMFormat drmFormat) {
        if (w <= 0 || h <= 0 || !g_pHyprRenderer)
            return false;

        if (!g_caFB) {
            g_caFB = g_pHyprRenderer->createFB("hyprbar_ca");
            if (!g_caFB)
                return false;
        }

        const DRMFormat reqFmt     = (drmFormat != 0 && drmFormat != DRM_FORMAT_INVALID) ? drmFormat : DRM_FORMAT_ARGB8888;
        const bool      needsAlloc = !g_caFB->isAllocated() ||
                                     static_cast<int>(std::lround(g_caFB->m_size.x)) != w ||
                                     static_cast<int>(std::lround(g_caFB->m_size.y)) != h ||
                                     g_lastReqFormat != reqFmt;

        if (needsAlloc) {
            GLint prevDrawFB    = 0;
            GLint prevReadFB    = 0;
            GLint prevActiveTex = GL_TEXTURE0;
            GLint prevTex0      = 0;
            glGetIntegerv(GL_DRAW_FRAMEBUFFER_BINDING, &prevDrawFB);
            glGetIntegerv(GL_READ_FRAMEBUFFER_BINDING, &prevReadFB);
            glGetIntegerv(GL_ACTIVE_TEXTURE, &prevActiveTex);
            glActiveTexture(GL_TEXTURE0);
            glGetIntegerv(GL_TEXTURE_BINDING_2D, &prevTex0);

            Hyprutils::Utils::CScopeGuard allocRestore([&]() {
                glActiveTexture(GL_TEXTURE0);
                glBindTexture(GL_TEXTURE_2D, static_cast<GLuint>(prevTex0));
                glActiveTexture(static_cast<GLenum>(prevActiveTex));
                glBindFramebuffer(GL_DRAW_FRAMEBUFFER, static_cast<GLuint>(prevDrawFB));
                glBindFramebuffer(GL_READ_FRAMEBUFFER, static_cast<GLuint>(prevReadFB));
            });

            bool ok = g_caFB->alloc(w, h, reqFmt);
            if (!ok && reqFmt != DRM_FORMAT_ARGB8888)
                ok = g_caFB->alloc(w, h, DRM_FORMAT_ARGB8888);

            if (!ok) {
                g_lastReqFormat = DRM_FORMAT_INVALID;
                return false;
            }

            g_lastReqFormat = reqFmt;
        }

        auto tex = g_caFB->getTexture();
        return g_caFB->isAllocated() && tex && tex->ok();
    }

    void hkRenderTextureWithBlurInternal(
        Render::GL::CHyprOpenGLImpl*                           thisptr,
        SP<Render::ITexture>                                   tex,
        const CBox&                                            box,
        const Render::GL::CHyprOpenGLImpl::STextureRenderData& data
    ) {
        auto orig = g_pBlurHook ? reinterpret_cast<origRenderTexWithBlur_t>(g_pBlurHook->m_original) : nullptr;
        if (!orig)
            return;

        if (g_inHook || g_program == 0 || g_vao == 0 || !g_cfgEnabled || !g_cfgEnabled->value()) {
            orig(thisptr, tex, box, data);
            return;
        }

        // Strict target matcher: status bar, Liquid Glass popups, and Fcitx5 IM popups only.
        // Never matches regular app windows or generic client-side xdg_popups.
        const bool enablePopups = g_cfgPopups ? g_cfgPopups->value() : true;
        const bool enableIM     = g_cfgInputMethods ? g_cfgInputMethods->value() : true;

        auto ls      = data.currentLS.lock();
        bool matched = false;
        if (ls) {
            const auto& ns = ls->m_namespace;
            if (ns == kBarNamespace) {
                matched = true;
            } else if (enablePopups && isPopupNamespace(ns)) {
                matched = true;
            } else if (enableIM && ns.find("fcitx") != std::string::npos) {
                matched = true;
            }
        } else if (enableIM && g_pInputManager && data.surface &&
                   g_pInputManager->m_relay.popupFromSurface(data.surface) != nullptr) {
            matched = true;
        }

        if (!matched) {
            orig(thisptr, tex, box, data);
            return;
        }

        if (!data.blurredBG || !data.blurredBG->ok() || data.blurredBG->m_texID == 0 || data.blurredBG->m_type == Render::TEXTURE_EXTERNAL) {
            orig(thisptr, tex, box, data);
            return;
        }

        const float strength      = g_cfgStrength ? g_cfgStrength->value() : 0.0f;
        const float edgeBoost     = g_cfgEdgeBoost ? g_cfgEdgeBoost->value() : 0.0f;
        const float verticalRatio = g_cfgVerticalRatio ? g_cfgVerticalRatio->value() : 0.0f;
        const float chromaBoost   = g_cfgChromaBoost ? g_cfgChromaBoost->value() : 1.45f;
        const float refract       = g_cfgRefract ? g_cfgRefract->value() : 9.0f;
        const float rimPrism      = g_cfgRimPrism ? g_cfgRimPrism->value() : 0.07f;
        const float dome          = g_cfgDome ? g_cfgDome->value() : 0.48f;
        const float maxBevel      = g_cfgMaxBevel ? g_cfgMaxBevel->value() : 20.0f;
        const float panelScale    = g_cfgPanelScale ? g_cfgPanelScale->value() : 0.85f;

        if (strength <= 0.0001f && edgeBoost <= 0.0001f && refract <= 0.0001f && rimPrism <= 0.0001f && dome <= 0.0001f) {
            orig(thisptr, tex, box, data);
            return;
        }

        if (!g_pHyprRenderer) {
            orig(thisptr, tex, box, data);
            return;
        }

        auto pMonitor = g_pHyprRenderer->m_renderData.pMonitor.lock();
        if (!pMonitor || pMonitor->m_pixelSize.x <= 0.0 || pMonitor->m_pixelSize.y <= 0.0 ||
            pMonitor->m_transformedSize.x <= 0.0 || pMonitor->m_transformedSize.y <= 0.0) {
            orig(thisptr, tex, box, data);
            return;
        }

        const int fbW = static_cast<int>(std::lround(data.blurredBG->m_size.x));
        const int fbH = static_cast<int>(std::lround(data.blurredBG->m_size.y));
        if (fbW <= 0 || fbH <= 0) {
            orig(thisptr, tex, box, data);
            return;
        }

        // Compute the target's exact bounding box in blurredBG pixel space (matches renderTextureWithBlurInternal).
        // box is in scaled m_transformedSize pixel space; after inverting m_transform, it is in m_pixelSize space.
        CBox transformedBox = box;
        transformedBox.transform(
            Math::wlTransformToHyprutils(Math::invertTransform(pMonitor->m_transform)),
            pMonitor->m_transformedSize.x,
            pMonitor->m_transformedSize.y
        );

        const double scaleX = static_cast<double>(fbW) / pMonitor->m_pixelSize.x;
        const double scaleY = static_cast<double>(fbH) / pMonitor->m_pixelSize.y;

        const double bx = transformedBox.x * scaleX;
        const double by = transformedBox.y * scaleY;
        const double bw = transformedBox.width * scaleX;
        const double bh = transformedBox.height * scaleY;

        if (bw <= 0.5 || bh <= 0.5) {
            orig(thisptr, tex, box, data);
            return;
        }

        const int sx = std::clamp<int>(static_cast<int>(std::floor(bx)) - kScissorPadPx, 0, fbW);
        const int sy = std::clamp<int>(static_cast<int>(std::floor(by)) - kScissorPadPx, 0, fbH);
        const int ex = std::clamp<int>(static_cast<int>(std::ceil(bx + bw)) + kScissorPadPx, 0, fbW);
        const int ey = std::clamp<int>(static_cast<int>(std::ceil(by + bh)) + kScissorPadPx, 0, fbH);
        const int sw = ex - sx;
        const int sh = ey - sy;

        if (sw <= 0 || sh <= 0) {
            orig(thisptr, tex, box, data);
            return;
        }

        const float monScale = std::max(pMonitor->m_scale, 1.0f) *
                               static_cast<float>(std::max(0.5 * (scaleX + scaleY), 0.1));
        const float maxBevelPx = std::clamp(maxBevel, 8.0f, 48.0f) * monScale;

        // Alpha-mask SDF mode for multi-card notifications (and oversized fullscreen logout-menu fallback).
        const bool wantsMask = ls && (
            ls->m_namespace == "notifications" ||
            (ls->m_namespace == "logout-menu" &&
             bw > 0.75 * static_cast<double>(fbW) &&
             bh > 0.75 * static_cast<double>(fbH))
        );
        const bool hasCustomCropUV =
            (data.primarySurfaceUVTopLeft.x >= 0.0 || data.primarySurfaceUVTopLeft.y >= 0.0) &&
            (data.primarySurfaceUVTopLeft != Vector2D(0.0, 0.0) ||
             data.primarySurfaceUVBottomRight != Vector2D(1.0, 1.0));
        const bool canSampleMask =
            tex &&
            tex->ok() &&
            tex->m_texID != 0 &&
            tex->m_type == Render::TEXTURE_RGBA &&
            !tex->m_opaque &&
            !hasCustomCropUV &&
            pMonitor->m_transform == WL_OUTPUT_TRANSFORM_NORMAL &&
            tex->m_transform == HYPRUTILS_TRANSFORM_NORMAL &&
            data.blurredBG->m_transform == HYPRUTILS_TRANSFORM_NORMAL;
        const bool  useMask     = wantsMask && canSampleMask;
        const float alphaThresh = (data.discardOpacity > 0.0f) ? data.discardOpacity : 0.1f;

        g_inHook = true;
        Hyprutils::Utils::CScopeGuard reentryGuard([&]() { g_inHook = false; });

        if (!ensureCAFramebuffer(fbW, fbH, data.blurredBG->m_drmFormat)) {
            orig(thisptr, tex, box, data);
            return;
        }

        auto* glFB = dynamic_cast<Render::GL::CGLFramebuffer*>(g_caFB.get());
        if (!glFB || glFB->getFBID() == 0) {
            orig(thisptr, tex, box, data);
            return;
        }

        // Save all raw GL state and restore identically on exit so CHyprOpenGLImpl caches stay 100% in sync.
        {
            GLint     prevDrawFB        = 0;
            GLint     prevReadFB        = 0;
            GLint     prevProgram       = 0;
            GLint     prevVAO           = 0;
            GLint     prevViewport[4]   = {0, 0, 0, 0};
            GLint     prevScissorBox[4] = {0, 0, 0, 0};
            GLint     prevActiveTex     = GL_TEXTURE0;
            GLint     prevTex0          = 0;
            GLint     prevTex1          = 0;
            GLboolean prevColorMask[4]  = {GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE};

            glGetIntegerv(GL_DRAW_FRAMEBUFFER_BINDING, &prevDrawFB);
            glGetIntegerv(GL_READ_FRAMEBUFFER_BINDING, &prevReadFB);
            glGetIntegerv(GL_CURRENT_PROGRAM, &prevProgram);
            glGetIntegerv(GL_VERTEX_ARRAY_BINDING, &prevVAO);
            glGetIntegerv(GL_VIEWPORT, prevViewport);
            glGetIntegerv(GL_SCISSOR_BOX, prevScissorBox);
            glGetIntegerv(GL_ACTIVE_TEXTURE, &prevActiveTex);
            glGetBooleanv(GL_COLOR_WRITEMASK, prevColorMask);

            const GLboolean prevBlend   = glIsEnabled(GL_BLEND);
            const GLboolean prevScissor = glIsEnabled(GL_SCISSOR_TEST);
            const GLboolean prevStencil = glIsEnabled(GL_STENCIL_TEST);
            const GLboolean prevDepth   = glIsEnabled(GL_DEPTH_TEST);
            const GLboolean prevCull    = glIsEnabled(GL_CULL_FACE);

            glActiveTexture(GL_TEXTURE0);
            glGetIntegerv(GL_TEXTURE_BINDING_2D, &prevTex0);
            glBindTexture(GL_TEXTURE_2D, data.blurredBG->m_texID);

            GLint prevMinFilter = GL_LINEAR;
            GLint prevMagFilter = GL_LINEAR;
            GLint prevWrapS     = GL_CLAMP_TO_EDGE;
            GLint prevWrapT     = GL_CLAMP_TO_EDGE;
            glGetTexParameteriv(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, &prevMinFilter);
            glGetTexParameteriv(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, &prevMagFilter);
            glGetTexParameteriv(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, &prevWrapS);
            glGetTexParameteriv(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, &prevWrapT);

            const bool modMin   = (prevMinFilter != GL_LINEAR);
            const bool modMag   = (prevMagFilter != GL_LINEAR);
            const bool modWrapS = (prevWrapS != GL_CLAMP_TO_EDGE);
            const bool modWrapT = (prevWrapT != GL_CLAMP_TO_EDGE);

            if (modMin)
                glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
            if (modMag)
                glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
            if (modWrapS)
                glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
            if (modWrapT)
                glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);

            if (useMask) {
                glActiveTexture(GL_TEXTURE1);
                glGetIntegerv(GL_TEXTURE_BINDING_2D, &prevTex1);
                glBindTexture(GL_TEXTURE_2D, tex->m_texID);
                // Do not call glTexParameteri on tex: preserves CGLTexture::m_cachedStates.
            }

            Hyprutils::Utils::CScopeGuard glRestore([&]() {
                if (useMask) {
                    glActiveTexture(GL_TEXTURE1);
                    glBindTexture(GL_TEXTURE_2D, static_cast<GLuint>(prevTex1));
                }

                glActiveTexture(GL_TEXTURE0);
                glBindTexture(GL_TEXTURE_2D, data.blurredBG->m_texID);
                if (modMin)
                    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, prevMinFilter);
                if (modMag)
                    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, prevMagFilter);
                if (modWrapS)
                    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, prevWrapS);
                if (modWrapT)
                    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, prevWrapT);

                glBindTexture(GL_TEXTURE_2D, static_cast<GLuint>(prevTex0));
                glActiveTexture(static_cast<GLenum>(prevActiveTex));

                glBindVertexArray(static_cast<GLuint>(prevVAO));
                glUseProgram(static_cast<GLuint>(prevProgram));
                glBindFramebuffer(GL_DRAW_FRAMEBUFFER, static_cast<GLuint>(prevDrawFB));
                glBindFramebuffer(GL_READ_FRAMEBUFFER, static_cast<GLuint>(prevReadFB));
                glViewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);
                glScissor(prevScissorBox[0], prevScissorBox[1], prevScissorBox[2], prevScissorBox[3]);
                glColorMask(prevColorMask[0], prevColorMask[1], prevColorMask[2], prevColorMask[3]);

                if (prevBlend)
                    glEnable(GL_BLEND);
                else
                    glDisable(GL_BLEND);

                if (prevScissor)
                    glEnable(GL_SCISSOR_TEST);
                else
                    glDisable(GL_SCISSOR_TEST);

                if (prevStencil)
                    glEnable(GL_STENCIL_TEST);
                else
                    glDisable(GL_STENCIL_TEST);

                if (prevDepth)
                    glEnable(GL_DEPTH_TEST);
                else
                    glDisable(GL_DEPTH_TEST);

                if (prevCull)
                    glEnable(GL_CULL_FACE);
                else
                    glDisable(GL_CULL_FACE);
            });

            glBindFramebuffer(GL_DRAW_FRAMEBUFFER, glFB->getFBID());
            glViewport(0, 0, fbW, fbH);
            glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
            glDisable(GL_BLEND);
            glDisable(GL_STENCIL_TEST);
            glDisable(GL_DEPTH_TEST);
            glDisable(GL_CULL_FACE);
            glEnable(GL_SCISSOR_TEST);
            glScissor(sx, sy, sw, sh);

            glUseProgram(g_program);
            glUniform1i(g_uTex, 0);
            if (g_uSurfaceTex >= 0)
                glUniform1i(g_uSurfaceTex, useMask ? 1 : 0);
            if (g_uTexelSize >= 0)
                glUniform2f(g_uTexelSize, 1.0f / static_cast<float>(fbW), 1.0f / static_cast<float>(fbH));
            if (g_uBoxMinUV >= 0)
                glUniform2f(g_uBoxMinUV, static_cast<float>(bx / fbW), static_cast<float>(by / fbH));
            if (g_uBoxSizeUV >= 0)
                glUniform2f(g_uBoxSizeUV, static_cast<float>(bw / fbW), static_cast<float>(bh / fbH));
            if (g_uBoxSizePx >= 0)
                glUniform2f(g_uBoxSizePx, static_cast<float>(bw), static_cast<float>(bh));
            if (g_uStrength >= 0)
                glUniform1f(g_uStrength, strength);
            if (g_uEdgeBoost >= 0)
                glUniform1f(g_uEdgeBoost, edgeBoost);
            if (g_uVerticalRatio >= 0)
                glUniform1f(g_uVerticalRatio, verticalRatio);
            if (g_uChromaBoost >= 0)
                glUniform1f(g_uChromaBoost, chromaBoost);
            if (g_uRefract >= 0)
                glUniform1f(g_uRefract, refract);
            if (g_uRimPrism >= 0)
                glUniform1f(g_uRimPrism, rimPrism);
            if (g_uDome >= 0)
                glUniform1f(g_uDome, dome);
            if (g_uMaxBevelPx >= 0)
                glUniform1f(g_uMaxBevelPx, maxBevelPx);
            if (g_uPanelScale >= 0)
                glUniform1f(g_uPanelScale, panelScale);
            if (g_uUseMask >= 0)
                glUniform1i(g_uUseMask, useMask ? 1 : 0);
            if (g_uAlphaThresh >= 0)
                glUniform1f(g_uAlphaThresh, alphaThresh);
            if (g_uMaskStepScale >= 0)
                glUniform1f(g_uMaskStepScale, monScale);

            glBindVertexArray(g_vao);
            glDrawArrays(GL_TRIANGLES, 0, 3);
        }

        auto caTex = g_caFB->getTexture();
        if (!caTex || !caTex->ok()) {
            orig(thisptr, tex, box, data);
            return;
        }

        caTex->m_imageDescription = data.blurredBG->m_imageDescription;
        caTex->m_transform        = data.blurredBG->m_transform;
        caTex->m_opaque           = data.blurredBG->m_opaque;
        g_caFB->setImageDescription(data.blurredBG->m_imageDescription);

        auto modData      = data;
        modData.blurredBG = caTex;
        orig(thisptr, tex, box, modData);
    }

} // namespace

APICALL EXPORT std::string PLUGIN_API_VERSION() {
    return HYPRLAND_API_VERSION;
}

APICALL EXPORT PLUGIN_DESCRIPTION_INFO PLUGIN_INIT(HANDLE handle) {
    g_handle = handle;

    const std::string serverHash = __hyprland_api_get_hash();
    const std::string clientHash = __hyprland_api_get_client_hash();
    if (serverHash != clientHash)
        throw std::runtime_error("[hyprbar-ca] Hyprland ABI hash mismatch (" + clientHash + " != " + serverHash + ")");

    if (!g_pHyprRenderer || g_pHyprRenderer->type() != Render::IHyprRenderer::RT_GL || !Render::GL::g_pHyprOpenGL)
        throw std::runtime_error("[hyprbar-ca] GL renderer not active");

    const auto matches = HyprlandAPI::findFunctionsByName(g_handle, "renderTextureWithBlurInternal");
    if (matches.size() != 1 || matches[0].address == nullptr)
        throw std::runtime_error("[hyprbar-ca] Expected exactly 1 renderTextureWithBlurInternal symbol, found " + std::to_string(matches.size()));

    constexpr auto kBlurRefresh = Config::Supplementary::REFRESH_BLUR_FB;

    g_cfgEnabled = Config::Values::makeConfigValue<Config::Values::CBoolValue>(
        "plugin:bar_ca:enabled",
        "Enable whole-glass chromatic aberration and 3D dome on status bar and Liquid Glass surfaces",
        true,
        Config::Values::SBoolValueOptions{.refresh = kBlurRefresh}
    );
    g_cfgPopups = Config::Values::makeConfigValue<Config::Values::CBoolValue>(
        "plugin:bar_ca:popups",
        "Enable chromatic aberration and 3D convex bevel on Liquid Glass popups (system-menu, notifications, logout-menu, osd, rofi)",
        true,
        Config::Values::SBoolValueOptions{.refresh = kBlurRefresh}
    );
    g_cfgInputMethods = Config::Values::makeConfigValue<Config::Values::CBoolValue>(
        "plugin:bar_ca:input_methods",
        "Enable chromatic aberration and 3D convex bevel on Wayland input-method popups (Fcitx5)",
        true,
        Config::Values::SBoolValueOptions{.refresh = kBlurRefresh}
    );
    g_cfgStrength = Config::Values::makeConfigValue<Config::Values::CFloatValue>(
        "plugin:bar_ca:strength",
        "Base whole-glass chromatic dispersion spread in pixels",
        10.5f,
        Config::Values::SFloatValueOptions{.min = 0.0f, .max = 40.0f, .refresh = kBlurRefresh}
    );
    g_cfgEdgeBoost = Config::Values::makeConfigValue<Config::Values::CFloatValue>(
        "plugin:bar_ca:edge_boost",
        "Additional chromatic dispersion along curved glass bevels in pixels",
        5.5f,
        Config::Values::SFloatValueOptions{.min = 0.0f, .max = 40.0f, .refresh = kBlurRefresh}
    );
    g_cfgVerticalRatio = Config::Values::makeConfigValue<Config::Values::CFloatValue>(
        "plugin:bar_ca:vertical_ratio",
        "Vertical-to-horizontal lens refraction ratio on curved top/bottom bevels",
        0.85f,
        Config::Values::SFloatValueOptions{.min = 0.0f, .max = 2.0f, .refresh = kBlurRefresh}
    );
    g_cfgChromaBoost = Config::Values::makeConfigValue<Config::Values::CFloatValue>(
        "plugin:bar_ca:chroma_boost",
        "Kawase-blur compensation gain applied exclusively to the chromatic dispersion delta",
        1.45f,
        Config::Values::SFloatValueOptions{.min = 0.0f, .max = 6.0f, .refresh = kBlurRefresh}
    );
    g_cfgRefract = Config::Values::makeConfigValue<Config::Values::CFloatValue>(
        "plugin:bar_ca:refract",
        "Convex lens refraction bend at the curved glass bevel in pixels",
        9.0f,
        Config::Values::SFloatValueOptions{.min = 0.0f, .max = 32.0f, .refresh = kBlurRefresh}
    );
    g_cfgRimPrism = Config::Values::makeConfigValue<Config::Values::CFloatValue>(
        "plugin:bar_ca:rim_prism",
        "Subtle luminance-driven Fresnel spectral dispersion across glass and meniscus rim",
        0.07f,
        Config::Values::SFloatValueOptions{.min = 0.0f, .max = 1.0f, .refresh = kBlurRefresh}
    );
    g_cfgDome = Config::Values::makeConfigValue<Config::Values::CFloatValue>(
        "plugin:bar_ca:dome",
        "Subtle 3D convex glass dome volume (gentle highlight, caustic bounce, and dome magnification)",
        0.48f,
        Config::Values::SFloatValueOptions{.min = 0.0f, .max = 1.5f, .refresh = kBlurRefresh}
    );
    g_cfgMaxBevel = Config::Values::makeConfigValue<Config::Values::CFloatValue>(
        "plugin:bar_ca:max_bevel",
        "Maximum convex glass bevel radius in pixels for large flat-core panels",
        20.0f,
        Config::Values::SFloatValueOptions{.min = 8.0f, .max = 48.0f, .refresh = kBlurRefresh}
    );
    g_cfgPanelScale = Config::Values::makeConfigValue<Config::Values::CFloatValue>(
        "plugin:bar_ca:panel_scale",
        "Intensity scale for strength, edge_boost, and dome on large flat-core panels (thin pills remain 1.0)",
        0.85f,
        Config::Values::SFloatValueOptions{.min = 0.2f, .max = 1.5f, .refresh = kBlurRefresh}
    );

    auto resetConfigs = []() {
        g_cfgEnabled.reset();
        g_cfgPopups.reset();
        g_cfgInputMethods.reset();
        g_cfgStrength.reset();
        g_cfgEdgeBoost.reset();
        g_cfgVerticalRatio.reset();
        g_cfgChromaBoost.reset();
        g_cfgRefract.reset();
        g_cfgRimPrism.reset();
        g_cfgDome.reset();
        g_cfgMaxBevel.reset();
        g_cfgPanelScale.reset();
    };

    if (!HyprlandAPI::addConfigValueV2(g_handle, g_cfgEnabled) ||
        !HyprlandAPI::addConfigValueV2(g_handle, g_cfgPopups) ||
        !HyprlandAPI::addConfigValueV2(g_handle, g_cfgInputMethods) ||
        !HyprlandAPI::addConfigValueV2(g_handle, g_cfgStrength) ||
        !HyprlandAPI::addConfigValueV2(g_handle, g_cfgEdgeBoost) ||
        !HyprlandAPI::addConfigValueV2(g_handle, g_cfgVerticalRatio) ||
        !HyprlandAPI::addConfigValueV2(g_handle, g_cfgChromaBoost) ||
        !HyprlandAPI::addConfigValueV2(g_handle, g_cfgRefract) ||
        !HyprlandAPI::addConfigValueV2(g_handle, g_cfgRimPrism) ||
        !HyprlandAPI::addConfigValueV2(g_handle, g_cfgDome) ||
        !HyprlandAPI::addConfigValueV2(g_handle, g_cfgMaxBevel) ||
        !HyprlandAPI::addConfigValueV2(g_handle, g_cfgPanelScale)) {
        resetConfigs();
        throw std::runtime_error("[hyprbar-ca] Failed to register plugin:bar_ca config values");
    }

    try {
        initGLResources();
    } catch (...) {
        resetConfigs();
        throw;
    }

    g_pBlurHook = HyprlandAPI::createFunctionHook(g_handle, matches[0].address, reinterpret_cast<void*>(&hkRenderTextureWithBlurInternal));
    if (!g_pBlurHook || !g_pBlurHook->hook()) {
        if (g_pBlurHook) {
            HyprlandAPI::removeFunctionHook(g_handle, g_pBlurHook);
            g_pBlurHook = nullptr;
        }
        destroyGLResources();
        resetConfigs();
        throw std::runtime_error("[hyprbar-ca] Failed to install renderTextureWithBlurInternal hook");
    }

    damageAllMonitors();

    return {
        "hyprbar-ca",
        "Whole-glass optical chromatic aberration & 3D convex dome for status bar, Liquid Glass popups, and Fcitx5 IM popups",
        "ca-dev",
        "3.0.0",
    };
}

APICALL EXPORT void PLUGIN_EXIT() {
    if (g_pBlurHook) {
        g_pBlurHook->unhook();
        HyprlandAPI::removeFunctionHook(g_handle, g_pBlurHook);
        g_pBlurHook = nullptr;
    }

    destroyGLResources();

    g_cfgEnabled.reset();
    g_cfgPopups.reset();
    g_cfgInputMethods.reset();
    g_cfgStrength.reset();
    g_cfgEdgeBoost.reset();
    g_cfgVerticalRatio.reset();
    g_cfgChromaBoost.reset();
    g_cfgRefract.reset();
    g_cfgRimPrism.reset();
    g_cfgDome.reset();
    g_cfgMaxBevel.reset();
    g_cfgPanelScale.reset();
    g_handle = nullptr;

    damageAllMonitors();
}
