"""Offline tests for the Hermes plugin; no real credentials or network."""
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

PLUGIN = Path(__file__).resolve().parents[1] / 'white-gloss-panel' / '__init__.py'

class PanelPluginTests(unittest.TestCase):
    def load_plugin(self):
        self.assertTrue(PLUGIN.is_file(), 'The read-only panel integration must exist')
        spec = importlib.util.spec_from_file_location('panel_plugin_under_test', PLUGIN)
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_unconfigured_tool_fails_closed_without_network(self):
        module = self.load_plugin()
        with patch.object(module, 'build_opener') as opener:
            result = json.loads(module.read_context({}, origin='https://panel.example.invalid', token=''))
        self.assertFalse(result['ok'])
        self.assertIn('nicht eingerichtet', result['error'])
        opener.assert_not_called()

    def test_reads_only_the_fixed_context_endpoint_with_bearer_and_bounded_query(self):
        module = self.load_plugin()
        payload = {'mode': 'read-only', 'total': 21, 'truncated': True, 'orders': []}
        from unittest.mock import MagicMock
        response = MagicMock()
        response.__enter__.return_value = response
        response.status = 200
        response.read.return_value = json.dumps(payload).encode()
        response.headers.get.return_value = 'application/json'
        with patch.object(module, 'build_opener') as factory:
            factory.return_value.open.return_value = response
            result = json.loads(module.read_context({'query': 'WG-42 & Auto'}, origin='https://panel.example.invalid', token='synthetic-token'))
        self.assertTrue(result['ok'])
        self.assertEqual(result['context'], payload)
        request = factory.return_value.open.call_args.args[0]
        self.assertEqual(request.get_method(), 'GET')
        self.assertEqual(request.full_url, 'https://panel.example.invalid/api/agent-bridge/context?q=WG-42+%26+Auto')
        self.assertEqual(request.get_header('Authorization'), 'Bearer synthetic-token')
        self.assertIsNone(request.data)
        self.assertEqual(factory.return_value.open.call_args.kwargs['timeout'], 20)

    def test_unsafe_origins_and_arguments_never_reach_the_network(self):
        module = self.load_plugin()
        cases = [('http://panel.example.invalid', {}), ('https://user:secret@panel.example.invalid', {}), ('https://panel.example.invalid/path', {}), ('https://panel.example.invalid?x=1', {}), ('https://panel.example.invalid#x', {}), ('https://panel.example.invalid:8443', {}), ('https://127.0.0.1', {}), ('https://localhost', {}), ('https://panel.example.invalid', {'query': 'x'*101}), ('https://panel.example.invalid', {'query': []}), ('https://panel.example.invalid', {'url': 'https://evil.invalid'})]
        for origin, args in cases:
            with self.subTest(origin=origin, args=args), patch.object(module, 'build_opener') as opener:
                result = json.loads(module.read_context(args, origin=origin, token='synthetic-token'))
                self.assertFalse(result['ok'])
                opener.assert_not_called()

    def test_redirects_and_invalid_context_are_refused_without_leaking_tokens(self):
        from unittest.mock import MagicMock
        module = self.load_plugin()
        self.assertIsNone(module.NoRedirect().redirect_request(None, None, 302, 'redirect', {}, 'https://evil.invalid'))
        for body, status in [(b'{}', 200), (b'[]', 200), (b'x'*131073, 200), (b'{"mode":"read-only","orders":[]}', 302)]:
            with self.subTest(status=status, size=len(body)), patch.object(module, 'build_opener') as factory:
                response = MagicMock()
                response.__enter__.return_value = response
                response.status = status
                response.read.return_value = body
                response.headers.get.return_value = 'application/json'
                factory.return_value.open.return_value = response
                result = module.read_context({}, origin='https://panel.example.invalid', token='synthetic-token')
                self.assertFalse(json.loads(result)['ok'])
                self.assertNotIn('synthetic-token', result)
                self.assertTrue(any(isinstance(handler, module.NoRedirect) for handler in factory.call_args.args))

    def test_register_exposes_one_read_only_tool_using_hermes_secret_scope(self):
        from unittest.mock import MagicMock
        module = self.load_plugin()
        self.assertTrue(callable(getattr(module, 'register', None)), 'Hermes registration is required')
        ctx = MagicMock()
        ctx.get_config.return_value = 'https://panel.example.invalid'
        module.register(ctx)
        ctx.register_tool.assert_called_once()
        kwargs = ctx.register_tool.call_args.kwargs
        self.assertEqual(kwargs['name'], 'white_gloss_context')
        self.assertEqual(kwargs['schema']['parameters']['additionalProperties'], False)
        with patch.object(module, 'panel_token', return_value='synthetic-token'), patch.object(module, 'read_context', return_value='{"ok":true}') as read:
            self.assertEqual(kwargs['handler']({'query': 'WG-42'}, task_id='test'), '{"ok":true}')
            read.assert_called_once_with({'query': 'WG-42'}, origin='https://panel.example.invalid', token='synthetic-token')

if __name__ == '__main__':
    unittest.main()
